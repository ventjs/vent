import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { HttpError, type Context, type Reply } from '../../src'
import type { Router } from '../../src/routing/router'
import { HttpServer } from '../../src/server/http-server'
import { DEFAULT_MAX_BODY_SIZE } from '../../src/http/read-request-body'
import type { SocketIOIntegration } from '../../src/types/socket-io-integration'

// ---------------------------------------------------------------------------
// Test router
//
// HttpServer only needs `match()` and `allowedMethods()` from the router, so these tests use
// a tiny in-memory router. That keeps the e2e suite about the HTTP layer (CORS, 404 / 405,
// body limits, parsing, error handling) and independent from the real Router's internals.
// ---------------------------------------------------------------------------

type TestHandler = (ctx: Context, reply: Reply) => unknown
type Params = Record<string, string>

interface TestRoute {
  readonly method: string
  readonly segments: readonly string[]
  readonly handler: TestHandler
}

const splitPath = (path: string): string[] => path.split('/').filter((segment) => segment !== '')

function matchSegments(pattern: readonly string[], path: string): Params | undefined {
  const actual = splitPath(path)
  if (actual.length !== pattern.length) return undefined

  const params: Params = {}

  for (const [index, part] of pattern.entries()) {
    const value = actual[index] as string

    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return undefined
  }

  return params
}

/** Routes are keyed as "METHOD /path", for example "GET /users/:id". */
function createTestRouter(routes: Record<string, TestHandler>): Router {
  const table: TestRoute[] = Object.entries(routes).map(([key, handler]) => {
    const [method, path] = key.split(' ') as [string, string]
    return { method, segments: splitPath(path), handler }
  })

  const router = {
    match(method: string, path: string) {
      for (const route of table) {
        if (route.method !== method) continue

        const params = matchSegments(route.segments, path)
        if (params !== undefined) return { handler: route.handler, params }
      }

      return undefined
    },

    allowedMethods(path: string): string[] {
      const methods = table
        .filter((route) => matchSegments(route.segments, path) !== undefined)
        .map((route) => route.method)

      return [...new Set(methods)]
    },
  }

  return router as unknown as Router
}

const routes: Record<string, TestHandler> = {
  'GET /ping': (_ctx, reply) => reply.OK({ pong: true }),

  'GET /users/:id': (ctx, reply) =>
    reply.OK({ id: ctx.params.id, query: Object.fromEntries(ctx.query) }),

  'GET /echo': (ctx, reply) =>
    reply.OK({
      method: ctx.method,
      path: ctx.path,
      header: ctx.headers.get('x-test'),
      query: Object.fromEntries(ctx.query),
    }),

  'GET /raw': () => new Response('raw body', { status: 202, headers: { 'x-raw': 'yes' } }),

  // two methods on the same path, to exercise 405 + the Allow header
  'GET /resource': (_ctx, reply) => reply.OK({ ok: true }),
  'DELETE /resource': (_ctx, reply) => reply.OK({ deleted: true }),

  'POST /json': async (ctx, reply) => {
    const body = await ctx.json<{ name: string }>()
    return reply.Created({ received: body })
  },

  'POST /text': async (ctx, reply) => reply.OK({ text: await ctx.text() }),

  'POST /form': async (ctx, reply) => {
    const form = await ctx.formData()
    const file = form.get('file') as File

    return reply.OK({
      name: form.get('name'),
      fileName: file.name,
      fileText: await file.text(),
    })
  },

  'GET /boom': () => {
    throw new Error('boom')
  },

  'GET /http-error': () => {
    throw new HttpError(409, 'Conflict')
  },

  // a handler that forgets to return a Response
  'GET /no-response': () => undefined,
}

interface Spy {
  mockRestore(): void
  mock: { calls: unknown[][] }
}

// ---------------------------------------------------------------------------
// Main suite
// ---------------------------------------------------------------------------

describe('HttpServer (e2e)', () => {
  let server: ReturnType<typeof HttpServer>
  let errorSpy: Spy
  let warnSpy: Spy

  const url = (path: string): string => `http://127.0.0.1:${server.port}${path}`

  beforeAll(() => {
    // port 0: the OS picks a free port, so the suite never clashes with a running app
    server = HttpServer(createTestRouter(routes), 0)
  })

  afterAll(() => {
    server.stop(true)
  })

  // The server logs every error / 404 on purpose; keep the test output clean.
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {}) as unknown as Spy
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {}) as unknown as Spy
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  describe('routing', () => {
    test('serves a matched route', async () => {
      const response = await fetch(url('/ping'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ pong: true })
    })

    test('passes route params and query string to the handler', async () => {
      const response = await fetch(url('/users/42?page=2&q=zen'))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: '42', query: { page: '2', q: 'zen' } })
    })

    test('decodes percent-encoded route params', async () => {
      const response = await fetch(url('/users/a%20b'))
      const body = (await response.json()) as { id: string }

      expect(body.id).toBe('a b')
    })

    test('exposes method, path (without query) and headers on ctx', async () => {
      const response = await fetch(url('/echo?x=1'), { headers: { 'x-test': 'hello' } })

      expect(await response.json()).toEqual({
        method: 'GET',
        path: '/echo',
        header: 'hello',
        query: { x: '1' },
      })
    })

    test('returns a Response from the handler untouched', async () => {
      const response = await fetch(url('/raw'))

      expect(response.status).toBe(202)
      expect(response.headers.get('x-raw')).toBe('yes')
      expect(await response.text()).toBe('raw body')
    })

    test('returns 404 for an unknown route and logs a warning', async () => {
      const response = await fetch(url('/does-not-exist'))

      expect(response.status).toBe(404)
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0)
    })

    test('returns 405 with an Allow header when the path exists for other methods', async () => {
      const response = await fetch(url('/resource'), { method: 'POST' })

      expect(response.status).toBe(405)
      expect(await response.json()).toEqual({ error: 'Method Not Allowed' })

      const allow = (response.headers.get('allow') ?? '').split(',').map((m) => m.trim())
      expect(allow.sort()).toEqual(['DELETE', 'GET'])
      expect(errorSpy.mock.calls.length).toBeGreaterThan(0)
    })

    test('does not treat /socket.io as special when no Socket.IO integration is set', async () => {
      const response = await fetch(url('/socket.io'))

      expect(response.status).toBe(404)
    })
  })

  describe('CORS preflight (OPTIONS)', () => {
    test('answers 204 with CORS headers when an Origin is sent', async () => {
      const response = await fetch(url('/ping'), {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
      expect(response.headers.get('access-control-allow-credentials')).toBe('true')
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      )
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Content-Type, Authorization',
      )
      expect(response.headers.get('access-control-max-age')).toBe('86400')
      expect(response.headers.get('vary')).toBe('Origin')
    })

    test('answers 204 without CORS headers when no Origin is sent', async () => {
      const response = await fetch(url('/ping'), { method: 'OPTIONS' })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    })

    test('answers preflight before routing, even for unknown paths', async () => {
      const response = await fetch(url('/does-not-exist'), {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      })

      expect(response.status).toBe(204)
    })
  })

  describe('JSON bodies', () => {
    test('parses a JSON body', async () => {
      const response = await fetch(url('/json'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Zen' }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ received: { name: 'Zen' } })
    })

    test('returns 400 for malformed JSON', async () => {
      const response = await fetch(url('/json'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      })

      expect(response.status).toBe(400)
    })

    test('rejects a non-JSON Content-Type', async () => {
      const response = await fetch(url('/json'), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Zen' }),
      })

      // the exact code (400 or 415) belongs to requireJsonContentType; both are client errors
      expect([400, 415]).toContain(response.status)
    })
  })

  describe('text bodies', () => {
    test('reads the body as UTF-8 text', async () => {
      const response = await fetch(url('/text'), {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: 'مرحبا VentJS 🐺',
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ text: 'مرحبا VentJS 🐺' })
    })
  })

  describe('form data', () => {
    test('parses multipart/form-data with a field and a file', async () => {
      const form = new FormData()
      form.set('name', 'Zen')
      form.set('file', new File(['hello world'], 'hello.txt', { type: 'text/plain' }))

      const response = await fetch(url('/form'), { method: 'POST', body: form })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        name: 'Zen',
        fileName: 'hello.txt',
        fileText: 'hello world',
      })
    })

    test('returns 400 when the multipart body is invalid', async () => {
      const response = await fetch(url('/form'), {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
        body: 'this is not a multipart body',
      })

      expect(response.status).toBe(400)
    })

    test('returns 400 when the Content-Type is missing', async () => {
      // a raw byte body carries no default Content-Type
      const response = await fetch(url('/form'), {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('body size limit', () => {
    test('returns 413 when Content-Length exceeds the default maximum', async () => {
      const response = await fetch(url('/text'), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: new Uint8Array(DEFAULT_MAX_BODY_SIZE + 1),
      })

      expect(response.status).toBe(413)
    })

    test('accepts a body exactly at the limit', async () => {
      const response = await fetch(url('/text'), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: new Uint8Array(DEFAULT_MAX_BODY_SIZE).fill(97),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('error handling', () => {
    test('turns an unexpected exception into a 500 and logs it', async () => {
      const response = await fetch(url('/boom'))

      expect(response.status).toBe(500)
      expect(errorSpy.mock.calls.length).toBeGreaterThan(0)
    })

    test('keeps the status of a thrown HttpError', async () => {
      const response = await fetch(url('/http-error'))

      expect(response.status).toBe(409)
    })

    test('returns 500 when a handler does not return a Response', async () => {
      const response = await fetch(url('/no-response'))

      expect(response.status).toBe(500)
      expect(errorSpy.mock.calls.length).toBeGreaterThan(0)
    })

    test('keeps serving after an error', async () => {
      await fetch(url('/boom'))
      const response = await fetch(url('/ping'))

      expect(response.status).toBe(200)
    })
  })

  describe('concurrency', () => {
    test('handles many simultaneous requests independently', async () => {
      const responses = await Promise.all(
        Array.from({ length: 50 }, (_, index) => fetch(url(`/users/${index}`))),
      )
      const bodies = (await Promise.all(responses.map((r) => r.json()))) as { id: string }[]

      expect(responses.every((r) => r.status === 200)).toBe(true)
      expect(bodies.map((body) => body.id)).toEqual(Array.from({ length: 50 }, (_, i) => String(i)))
    })
  })
})

// ---------------------------------------------------------------------------
// Startup callback
// ---------------------------------------------------------------------------

describe('HttpServer startup', () => {
  test('calls the callback once the server is created', () => {
    const callback = mock(() => {})
    const server = HttpServer(createTestRouter({}), 0, callback)

    try {
      expect(callback).toHaveBeenCalledTimes(1)
      expect(server.port).toBeGreaterThan(0)
    } finally {
      server.stop(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Socket.IO integration
//
// A fake integration is enough here: the server only has to hand `/socket.io` requests to
// `engine.handleRequest` before the HTTP router sees them.
// ---------------------------------------------------------------------------

describe('HttpServer with Socket.IO', () => {
  let server: ReturnType<typeof HttpServer>
  let errorSpy: Spy
  let warnSpy: Spy

  const handleRequest = mock(
    (_request: Request, _server: unknown) => new Response('socket-ok', { status: 200 }),
  )

  const socketIO = {
    path: '/socket.io',
    engine: {
      handler: () => ({ websocket: { message() {} } }),
      handleRequest,
    },
  } as unknown as SocketIOIntegration

  const url = (path: string): string => `http://127.0.0.1:${server.port}${path}`

  beforeAll(() => {
    server = HttpServer(createTestRouter(routes), 0, undefined, socketIO)
  })

  afterAll(() => {
    server.stop(true)
  })

  beforeEach(() => {
    handleRequest.mockClear()
    errorSpy = spyOn(console, 'error').mockImplementation(() => {}) as unknown as Spy
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {}) as unknown as Spy
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('hands the Socket.IO path to the engine instead of the router', async () => {
    const response = await fetch(url('/socket.io'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('socket-ok')
    expect(handleRequest).toHaveBeenCalledTimes(1)
  })

  test('ignores trailing slashes on the Socket.IO path', async () => {
    const response = await fetch(url('/socket.io/'))

    expect(await response.text()).toBe('socket-ok')
    expect(handleRequest).toHaveBeenCalledTimes(1)
  })

  test('passes the Request and the server instance to the engine', async () => {
    await fetch(url('/socket.io?EIO=4&transport=polling'))

    const [request, receivedServer] = handleRequest.mock.calls[0] as [Request, unknown]

    expect(new URL(request.url).searchParams.get('EIO')).toBe('4')
    expect(receivedServer).toBeDefined()
  })

  test('does not capture other paths', async () => {
    const response = await fetch(url('/ping'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pong: true })
    expect(handleRequest).not.toHaveBeenCalled()
  })

  test('does not capture sub-paths of the Socket.IO path', async () => {
    const response = await fetch(url('/socket.io/extra'))

    expect(response.status).toBe(404)
    expect(handleRequest).not.toHaveBeenCalled()
  })
})
