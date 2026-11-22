import { describe, expect, it, mock } from 'bun:test'
import { createAuthProvider } from '../../../src/di/auth-provider'
import { AuthMiddleware } from '../../../src/middleware/auth-middleware'
import type { AuthConfig, TokenVerifierSource } from '../../../src/di/module'
import type { Context, ContextMiddleware } from '../../../src'

class TestVerifier implements TokenVerifierSource {
  readonly secret = 'test-secret'

  verifyToken(token: string) {
    return {
      id: `${this.secret}:${token}`,
    }
  }
}

function createConfig(
  verifier: AuthConfig['verifier'],
  mode: AuthConfig['mode'] = 'bearer',
): AuthConfig {
  if (mode === 'bearer') {
    return { verifier, mode }
  }

  return {
    verifier,
    mode,
    cookieName: 'auth_token',
  }
}

function createRequest(options?: { authorization?: string; cookie?: string }): Context {
  const headers = new Headers()

  if (options?.authorization) {
    headers.set('authorization', options.authorization)
  }

  if (options?.cookie) {
    headers.set('cookie', options.cookie)
  }

  const request = new Request('http://localhost/', { headers })

  return {
    request,
    headers: request.headers,
  } as Context
}

function createResponse() {
  return {
    Unauthorized: mock((payload: unknown) => Response.json(payload, { status: 401 })),
  } as unknown as Parameters<ContextMiddleware<Context>>[1]
}

function createNext() {
  return mock(async () => Response.json({ message: 'Next middleware called' }))
}

async function executeAuth(
  provider: ReturnType<typeof createAuthProvider>,
  verifier: TokenVerifierSource,
  ctx: Context,
) {
  const middleware = provider.create([verifier]) as AuthMiddleware
  const reply = createResponse()
  const next = createNext()

  const result = await middleware.middleware(ctx, reply, next)

  return { result, next, middleware }
}

describe('createAuthProvider', () => {
  it('should register AuthMiddleware as its provider token', () => {
    const provider = createAuthProvider(createConfig(TestVerifier))

    expect(provider.token).toBe(AuthMiddleware)
  })

  it('should register the verifier as its dependency', () => {
    const provider = createAuthProvider(createConfig(TestVerifier))

    expect(provider.deps).toEqual([TestVerifier])
  })

  it('should create an AuthMiddleware instance', () => {
    const provider = createAuthProvider(createConfig(TestVerifier))

    const middleware = provider.create([new TestVerifier()])

    expect(middleware).toBeInstanceOf(AuthMiddleware)
  })

  it('should authenticate using bearer tokens', async () => {
    const provider = createAuthProvider(createConfig(TestVerifier, 'bearer'))

    const verifier = new TestVerifier()
    const request = createRequest({
      authorization: 'Bearer valid-token',
    })

    const { result, next } = await executeAuth(provider, verifier, request)

    expect(result.status).toBe(200)
    expect(request.user).toEqual({
      id: 'test-secret:valid-token',
    })
    expect(request.auth).toEqual({
      token: 'valid-token',
    })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('should authenticate using the configured cookie name', async () => {
    const provider = createAuthProvider(createConfig(TestVerifier, 'cookie'))

    const verifier = new TestVerifier()
    const request = createRequest({
      cookie: 'auth_token=cookie-token',
    })

    const { result, next } = await executeAuth(provider, verifier, request)

    expect(result.status).toBe(200)
    expect(request.user).toEqual({
      id: 'test-secret:cookie-token',
    })
    expect(request.auth).toEqual({
      token: 'cookie-token',
    })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('should support both bearer and cookie authentication', async () => {
    const provider = createAuthProvider(createConfig(TestVerifier, 'both'))

    const verifier = new TestVerifier()
    const request = createRequest({
      authorization: 'Bearer bearer-token',
      cookie: 'auth_token=cookie-token',
    })

    const { result } = await executeAuth(provider, verifier, request)

    expect(result.status).toBe(200)
    expect(request.auth).toEqual({
      token: 'bearer-token',
    })
  })

  it('should preserve the verifier this context', async () => {
    const provider = createAuthProvider(createConfig(TestVerifier))

    const verifier = new TestVerifier()
    const request = createRequest({
      authorization: 'Bearer context-token',
    })

    const { result } = await executeAuth(provider, verifier, request)

    expect(result.status).toBe(200)
    expect(request.user).toEqual({
      id: 'test-secret:context-token',
    })
  })

  it('should return 401 when bearer token is missing', async () => {
    const provider = createAuthProvider(createConfig(TestVerifier, 'bearer'))

    const verifier = new TestVerifier()
    const request = createRequest()

    const { result, next } = await executeAuth(provider, verifier, request)

    expect(result.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
