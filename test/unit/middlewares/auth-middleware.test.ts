import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { Context, NextFunc, Reply } from '../../../src';
import { AuthMiddleware, type AuthMiddlewareOptions, type TokenVerifier, type VerifiedUser } from '../../../src/middleware/auth-middleware';
import { ErrorHandler } from '../../../src/errors/error-handler';

// ---------------------------------------------------------------------------
// Helpers
//
// The middleware only reads `ctx.headers` and `ctx.request` (the cookie library parses the real
// `Request`), and writes `ctx.user` / `ctx.auth`. A small fake context is enough; the cookie
// parsing itself is NOT mocked.
// ---------------------------------------------------------------------------

type TestContext = Context & { user?: unknown; auth?: unknown }

function makeContext(headers: Record<string, string> = {}): TestContext {
  const request = new Request('http://localhost/secure', { headers })

  return {
    request,
    headers: request.headers,
    method: 'GET',
    path: '/secure',
  } as unknown as TestContext
}

// Only `Unauthorized` is used by the middleware.
const reply = {
  Unauthorized: (body: unknown) => Response.json(body, { status: 401 }),
} as unknown as Reply

const createNext = () => mock<NextFunc>(async () => new Response('downstream', { status: 200 }))

const user: VerifiedUser = { id: 'user-1', role: 'admin' }

const createVerifier = () =>
  mock<TokenVerifier>(async (token) => (token === 'good-token' ? user : null))

interface Spy {
  mockRestore(): void
  mock: { calls: unknown[][] }
}

let errorSpy: Spy
let handleSpy: Spy
const handled = new Response('handled', { status: 500 })

beforeEach(() => {
  errorSpy = spyOn(console, 'error').mockImplementation(() => {}) as unknown as Spy
  // ErrorHandler has its own tests; here it only has to be called with the right error.
  handleSpy = spyOn(ErrorHandler, 'handle').mockImplementation(
    (() => handled) as never,
  ) as unknown as Spy
})

afterEach(() => {
  errorSpy.mockRestore()
  handleSpy.mockRestore()
})

async function expectRejected(
  response: Response,
  message: string,
  verifier: ReturnType<typeof createVerifier>,
  next: ReturnType<typeof createNext>,
): Promise<void> {
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ success: false, message })
  expect(verifier).not.toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
}

const MISSING = 'Authentication token is missing or invalid.'
const INVALID = 'Token is invalid or expired.'

// ---------------------------------------------------------------------------
// Default options (mode "both", cookie "token")
// ---------------------------------------------------------------------------

describe('AuthMiddleware: default options', () => {
  test('accepts a Bearer token and calls next', async () => {
    const verifier = createVerifier()
    const next = createNext()
    const ctx = makeContext({ authorization: 'Bearer good-token' })

    const response = await new AuthMiddleware(verifier).middleware(ctx, reply, next)

    expect(verifier).toHaveBeenCalledTimes(1)
    expect(verifier).toHaveBeenCalledWith('good-token')
    expect(next).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('downstream')
  })

  test('puts the verified user and the token on ctx', async () => {
    const ctx = makeContext({ authorization: 'Bearer good-token' })

    await new AuthMiddleware(createVerifier()).middleware(ctx, reply, createNext())

    expect(ctx.user).toBe(user)
    expect(ctx.auth).toEqual({ token: 'good-token' })
  })

  test('falls back to the "token" cookie when there is no Authorization header', async () => {
    const verifier = createVerifier()
    const next = createNext()
    const ctx = makeContext({ cookie: 'token=good-token' })

    const response = await new AuthMiddleware(verifier).middleware(ctx, reply, next)

    expect(verifier).toHaveBeenCalledWith('good-token')
    expect(response.status).toBe(200)
    expect(ctx.auth).toEqual({ token: 'good-token' })
  })

  test('finds the cookie among other cookies', async () => {
    const verifier = createVerifier()
    const ctx = makeContext({ cookie: 'theme=dark; token=good-token; lang=ar' })

    await new AuthMiddleware(verifier).middleware(ctx, reply, createNext())

    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('the Authorization header wins over the cookie', async () => {
    const verifier = createVerifier()
    const ctx = makeContext({
      authorization: 'Bearer good-token',
      cookie: 'token=cookie-token',
    })

    await new AuthMiddleware(verifier).middleware(ctx, reply, createNext())

    expect(verifier).toHaveBeenCalledTimes(1)
    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('returns 401 when there is no token at all', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier).middleware(makeContext(), reply, next)

    await expectRejected(response, MISSING, verifier, next)
  })

  test('returns 401 when the cookie is empty', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier).middleware(
      makeContext({ cookie: 'token=' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })

  test('ignores cookies with a different name', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier).middleware(
      makeContext({ cookie: 'session=good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })
})

// ---------------------------------------------------------------------------
// Authorization header format
// ---------------------------------------------------------------------------

describe('AuthMiddleware: Authorization header format', () => {
  for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
    test(`accepts the "${scheme}" scheme in any letter case`, async () => {
      const verifier = createVerifier()

      await new AuthMiddleware(verifier).middleware(
        makeContext({ authorization: `${scheme} good-token` }),
        reply,
        createNext(),
      )

      expect(verifier).toHaveBeenCalledWith('good-token')
    })
  }

  test('accepts several spaces between the scheme and the token', async () => {
    const verifier = createVerifier()

    await new AuthMiddleware(verifier).middleware(
      makeContext({ authorization: 'Bearer     good-token' }),
      reply,
      createNext(),
    )

    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('passes a JWT-shaped token to the verifier untouched', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123'
    const verifier = mock<TokenVerifier>(async () => user)

    await new AuthMiddleware(verifier).middleware(
      makeContext({ authorization: `Bearer ${jwt}` }),
      reply,
      createNext(),
    )

    expect(verifier).toHaveBeenCalledWith(jwt)
  })

  const malformed = [
    'Basic good-token',
    'Bearer',
    'Bearertoken',
    'Bearer two tokens',
    'Token good-token',
  ]

  for (const header of malformed) {
    test(`rejects the malformed header ${JSON.stringify(header)}`, async () => {
      const verifier = createVerifier()
      const next = createNext()

      const response = await new AuthMiddleware(verifier).middleware(
        makeContext({ authorization: header }),
        reply,
        next,
      )

      await expectRejected(response, MISSING, verifier, next)
    })
  }

  test('a malformed Authorization header does NOT fall back to the cookie', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier).middleware(
      makeContext({ authorization: 'Basic abc', cookie: 'token=good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })
})

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

describe('AuthMiddleware: mode "bearer"', () => {
  const options: AuthMiddlewareOptions = { mode: 'bearer' }

  test('accepts a Bearer token', async () => {
    const verifier = createVerifier()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      createNext(),
    )

    expect(response.status).toBe(200)
    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('ignores cookies', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ cookie: 'token=good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })

  test('rejects a request without Authorization', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext(),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })
})

describe('AuthMiddleware: mode "cookie"', () => {
  const options: AuthMiddlewareOptions = { mode: 'cookie', cookieName: 'session' }

  test('reads the configured cookie name', async () => {
    const verifier = createVerifier()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ cookie: 'session=good-token' }),
      reply,
      createNext(),
    )

    expect(response.status).toBe(200)
    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('does not read a cookie with another name', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ cookie: 'token=good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })

  test('ignores the Authorization header', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })

  test('uses the cookie even when an Authorization header is also sent', async () => {
    const verifier = createVerifier()

    await new AuthMiddleware(verifier, options).middleware(
      makeContext({ authorization: 'Bearer header-token', cookie: 'session=cookie-token' }),
      reply,
      createNext(),
    )

    expect(verifier).toHaveBeenCalledTimes(1)
    expect(verifier).toHaveBeenCalledWith('cookie-token')
  })
})

describe('AuthMiddleware: mode "both" with a custom cookie name', () => {
  const options: AuthMiddlewareOptions = { mode: 'both', cookieName: 'sid' }

  test('reads the custom cookie when there is no header', async () => {
    const verifier = createVerifier()

    await new AuthMiddleware(verifier, options).middleware(
      makeContext({ cookie: 'sid=good-token' }),
      reply,
      createNext(),
    )

    expect(verifier).toHaveBeenCalledWith('good-token')
  })

  test('does not read the default "token" cookie', async () => {
    const verifier = createVerifier()
    const next = createNext()

    const response = await new AuthMiddleware(verifier, options).middleware(
      makeContext({ cookie: 'token=good-token' }),
      reply,
      next,
    )

    await expectRejected(response, MISSING, verifier, next)
  })

  test('still accepts a Bearer token', async () => {
    const verifier = createVerifier()

    await new AuthMiddleware(verifier, options).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      createNext(),
    )

    expect(verifier).toHaveBeenCalledWith('good-token')
  })
})

// ---------------------------------------------------------------------------
// Verification outcome
// ---------------------------------------------------------------------------

describe('AuthMiddleware: token verification', () => {
  test('returns 401 when the verifier returns null', async () => {
    const verifier = createVerifier()
    const next = createNext()
    const ctx = makeContext({ authorization: 'Bearer wrong-token' })

    const response = await new AuthMiddleware(verifier).middleware(ctx, reply, next)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, message: INVALID })
    expect(verifier).toHaveBeenCalledWith('wrong-token')
    expect(next).not.toHaveBeenCalled()
  })

  test('does not set ctx.user or ctx.auth when verification fails', async () => {
    const ctx = makeContext({ authorization: 'Bearer wrong-token' })

    await new AuthMiddleware(createVerifier()).middleware(ctx, reply, createNext())

    expect(ctx.user).toBeUndefined()
    expect(ctx.auth).toBeUndefined()
  })

  test('works with a synchronous verifier', async () => {
    const verifier = mock<TokenVerifier>((token) => (token === 'good-token' ? user : null))
    const ctx = makeContext({ authorization: 'Bearer good-token' })

    const response = await new AuthMiddleware(verifier).middleware(ctx, reply, createNext())

    expect(response.status).toBe(200)
    expect(ctx.user).toBe(user)
  })

  test('returns the downstream response unchanged', async () => {
    const downstream = new Response('created', { status: 201, headers: { 'x-test': '1' } })
    const next = mock<NextFunc>(async () => downstream)

    const response = await new AuthMiddleware(createVerifier()).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      next,
    )

    expect(response).toBe(downstream)
  })

  test('is not tied to `this`: the middleware can be passed around detached', async () => {
    const { middleware } = new AuthMiddleware(createVerifier())

    const response = await middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      createNext(),
    )

    expect(response.status).toBe(200)
  })

  test('keeps concurrent requests separate', async () => {
    const auth = new AuthMiddleware(
      mock<TokenVerifier>(async (token) => ({ id: token.toUpperCase() })),
    )
    const first = makeContext({ authorization: 'Bearer aaa' })
    const second = makeContext({ authorization: 'Bearer bbb' })

    await Promise.all([
      auth.middleware(first, reply, createNext()),
      auth.middleware(second, reply, createNext()),
    ])

    expect(first.user).toEqual({ id: 'AAA' })
    expect(second.user).toEqual({ id: 'BBB' })
    expect(first.auth).toEqual({ token: 'aaa' })
    expect(second.auth).toEqual({ token: 'bbb' })
  })
})

// ---------------------------------------------------------------------------
// Verifier errors
// ---------------------------------------------------------------------------

describe('AuthMiddleware: verifier errors', () => {
  test('a rejected promise goes to ErrorHandler and is logged', async () => {
    const failure = new Error('database down')
    const verifier = mock<TokenVerifier>(async () => {
      throw failure
    })
    const next = createNext()

    const response = await new AuthMiddleware(verifier).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      next,
    )

    expect(response).toBe(handled)
    expect(handleSpy.mock.calls).toEqual([[failure]])
    expect(errorSpy.mock.calls).toEqual([['[VentJS] Token verification failed:', failure]])
    expect(next).not.toHaveBeenCalled()
  })

  test('a synchronous throw is handled the same way', async () => {
    const failure = new Error('boom')
    const verifier = mock<TokenVerifier>(() => {
      throw failure
    })

    const response = await new AuthMiddleware(verifier).middleware(
      makeContext({ authorization: 'Bearer good-token' }),
      reply,
      createNext(),
    )

    expect(response).toBe(handled)
    expect(handleSpy.mock.calls).toEqual([[failure]])
  })

  test('does not set ctx.user when the verifier throws', async () => {
    const ctx = makeContext({ authorization: 'Bearer good-token' })
    const verifier = mock<TokenVerifier>(async () => {
      throw new Error('boom')
    })

    await new AuthMiddleware(verifier).middleware(ctx, reply, createNext())

    expect(ctx.user).toBeUndefined()
    expect(ctx.auth).toBeUndefined()
  })

  test('does not call the verifier or ErrorHandler when there is no token', async () => {
    const verifier = createVerifier()

    await new AuthMiddleware(verifier).middleware(makeContext(), reply, createNext())

    expect(verifier).not.toHaveBeenCalled()
    expect(handleSpy.mock.calls).toHaveLength(0)
    expect(errorSpy.mock.calls).toHaveLength(0)
  })
})
