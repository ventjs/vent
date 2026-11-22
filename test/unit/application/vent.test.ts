import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { Server as SocketIOServer } from 'socket.io'
import { Vent } from '../../../src/application/vent'
import { DIModule } from '../../../src'
import type { ModuleClass } from '../../../src/di/module'

/**
 * These tests exercise Vent through its public API. Request handling is
 * tested end to end: the app listens on a random port (listen(0)) and is
 * called with fetch, so the tests do not depend on the internal shape of
 * Router / MiddlewarePipeline.
 */

type Listening = { port: number; stop: (force?: boolean) => unknown }

const servers: Listening[] = []

function start(app: Vent): string {
  const server = app.listen(0) as unknown as Listening
  servers.push(server)
  return `http://localhost:${server.port}`
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.stop(true)
  }
})

// Internals used only where the public API can't observe the behavior.
const internals = (app: Vent) =>
  app as unknown as {
    socketIo?: { io: SocketIOServer; engine: unknown; path: string }
    container: { set: (...args: unknown[]) => unknown }
    moduleLoader: {
      load: (...args: unknown[]) => unknown
      resolve: (...args: unknown[]) => unknown
    }
  }

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

describe('route registration', () => {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

  for (const method of methods) {
    test(`${method}() returns the same instance (chainable)`, () => {
      const app = new Vent()

      expect(app[method]('/x', () => new Response('ok'))).toBe(app)
    })

    test(`${method}() registers a route`, () => {
      const app = new Vent()
      app[method]('/things', () => new Response('ok'))

      const routes = app.readRoutes()

      expect(routes).toHaveLength(1)
      expect(routes[0]).toMatchObject({ method, path: '/things' })
    })

    test(`${method}() throws when the path does not start with "/"`, () => {
      const app = new Vent()

      expect(() => app[method]('things', () => new Response('ok'))).toThrow(
        'Invalid path "things". The path must start with "/".',
      )
    })
  }

  test('an invalid path does not register a route', () => {
    const app = new Vent()

    expect(() => app.GET('nope', () => new Response('ok'))).toThrow()
    expect(app.readRoutes()).toHaveLength(0)
  })

  test('readRoutes() is empty for a new app', () => {
    expect(new Vent().readRoutes()).toHaveLength(0)
  })

  test('readRoutes() lists every registered route', () => {
    const app = new Vent()
      .GET('/a', () => new Response('a'))
      .POST('/b', () => new Response('b'))
      .DELETE('/c', () => new Response('c'))

    expect(app.readRoutes()).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Request handling (through the real HTTP server)
// ---------------------------------------------------------------------------

describe('request handling', () => {
  test('GET handler responds', async () => {
    const app = new Vent().GET('/hello', () => new Response('hello'))
    const base = start(app)

    const res = await fetch(`${base}/hello`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })

  test('the handler receives ctx and reply', async () => {
    const app = new Vent().GET('/reply', (_ctx, reply) => reply.OK({ via: 'reply' }))
    const base = start(app)

    const res = await fetch(`${base}/reply`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ via: 'reply' })
  })

  test('async handlers are awaited', async () => {
    const app = new Vent().GET('/async', async () => {
      await Bun.sleep(5)
      return new Response('late')
    })
    const base = start(app)

    expect(await (await fetch(`${base}/async`)).text()).toBe('late')
  })

  test('each HTTP method is routed to its own handler', async () => {
    const app = new Vent()
      .GET('/m', () => new Response('get'))
      .POST('/m', () => new Response('post'))
      .PUT('/m', () => new Response('put'))
      .PATCH('/m', () => new Response('patch'))
      .DELETE('/m', () => new Response('delete'))
    const base = start(app)

    const text = async (method: string) => (await fetch(`${base}/m`, { method })).text()

    expect(await text('GET')).toBe('get')
    expect(await text('POST')).toBe('post')
    expect(await text('PUT')).toBe('put')
    expect(await text('PATCH')).toBe('patch')
    expect(await text('DELETE')).toBe('delete')
  })

  test('an unknown route does not return 200', async () => {
    const app = new Vent().GET('/exists', () => new Response('ok'))
    const base = start(app)

    const res = await fetch(`${base}/missing`)

    expect(res.status).toBe(404)
  })

  test('a handler that does not return a Response yields 500 and logs an error', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const app = new Vent().GET('/bad', (() => undefined) as never)
    const base = start(app)

    const res = await fetch(`${base}/bad`)

    expect(res.status).toBe(500)
    expect(errorSpy).toHaveBeenCalledWith('[VentJS] Handler did not return a Response.')

    errorSpy.mockRestore()
  })

  test('a throwing handler does not crash the server', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const app = new Vent()
      .GET('/boom', () => {
        throw new Error('boom')
      })
      .GET('/ok', () => new Response('ok'))
    const base = start(app)

    const boom = await fetch(`${base}/boom`)
    const ok = await fetch(`${base}/ok`)

    expect(boom.status).toBeGreaterThanOrEqual(500)
    expect(ok.status).toBe(200)

    errorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

describe('middleware', () => {
  test('use() returns the same instance (chainable)', () => {
    const app = new Vent()

    expect(app.use((_ctx, _reply, next) => next())).toBe(app)
  })

  test('global middleware runs before the handler', async () => {
    const calls: string[] = []
    const app = new Vent()
      .use(async (_ctx, _reply, next) => {
        calls.push('global')
        return next()
      })
      .GET('/x', () => {
        calls.push('handler')
        return new Response('ok')
      })
    const base = start(app)

    await fetch(`${base}/x`)

    expect(calls).toEqual(['global', 'handler'])
  })

  test('global middleware runs before route middleware, in registration order', async () => {
    const calls: string[] = []
    const track =
      (name: string) => async (_ctx: unknown, _reply: unknown, next: () => Promise<Response>) => {
        calls.push(name)
        return next()
      }

    const app = new Vent()
      .use(track('global-1') as never)
      .use(track('global-2') as never)
      .GET(
        '/x',
        () => {
          calls.push('handler')
          return new Response('ok')
        },
        track('route-1') as never,
        track('route-2') as never,
      )
    const base = start(app)

    await fetch(`${base}/x`)

    expect(calls).toEqual(['global-1', 'global-2', 'route-1', 'route-2', 'handler'])
  })

  test('global middleware added after a route is not applied to that route', async () => {
    const calls: string[] = []
    const app = new Vent()
      .GET('/early', () => new Response('early'))
      .use(async (_ctx, _reply, next) => {
        calls.push('late-global')
        return next()
      })
      .GET('/late', () => new Response('late'))
    const base = start(app)

    await fetch(`${base}/early`)
    expect(calls).toEqual([])

    await fetch(`${base}/late`)
    expect(calls).toEqual(['late-global'])
  })

  test('middleware can short-circuit without calling the handler', async () => {
    const handler = mock(() => new Response('handler'))
    const app = new Vent().use(async (_ctx, reply) => reply.Unauthorized()).GET('/secure', handler)
    const base = start(app)

    const res = await fetch(`${base}/secure`)

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  test('route middleware applies only to its own route', async () => {
    const mw = mock(async (_ctx: unknown, _reply: unknown, next: () => Promise<Response>) => next())
    const app = new Vent()
      .GET('/with', () => new Response('a'), mw as never)
      .GET('/without', () => new Response('b'))
    const base = start(app)

    await fetch(`${base}/without`)
    expect(mw).not.toHaveBeenCalled()

    await fetch(`${base}/with`)
    expect(mw).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

describe('group()', () => {
  test('returns the same instance (chainable)', () => {
    const app = new Vent()

    expect(app.group('/api', () => {})).toBe(app)
  })

  test('invokes the callback synchronously with a group', () => {
    const app = new Vent()
    const callback = mock(() => {})

    app.group('/api', callback)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  test('routes defined in a group are registered on the app', () => {
    const app = new Vent()

    app.group('/api', (group) => {
      group.GET('/users', () => new Response('users'))
    })

    expect(app.readRoutes()).toHaveLength(1)
  })

  test('group routes are reachable under the prefix', async () => {
    const app = new Vent().group('/api', (group) => {
      group.GET('/users', () => new Response('users'))
    })
    const base = start(app)

    const res = await fetch(`${base}/api/users`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('users')
  })

  test('group middleware runs for group routes', async () => {
    const calls: string[] = []
    const app = new Vent().group(
      '/api',
      (group) => {
        group.GET('/users', () => {
          calls.push('handler')
          return new Response('users')
        })
      },
      async (_ctx, _reply, next) => {
        calls.push('group-mw')
        return next()
      },
    )
    const base = start(app)

    await fetch(`${base}/api/users`)

    expect(calls).toEqual(['group-mw', 'handler'])
  })

  test('global middleware still applies to group routes', async () => {
    const calls: string[] = []
    const app = new Vent()
      .use(async (_ctx, _reply, next) => {
        calls.push('global')
        return next()
      })
      .group('/api', (group) => {
        group.GET('/users', () => {
          calls.push('handler')
          return new Response('users')
        })
      })
    const base = start(app)

    await fetch(`${base}/api/users`)

    expect(calls).toEqual(['global', 'handler'])
  })
})

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

describe('socketIO()', () => {
  test('returns a Socket.IO server', () => {
    const io = new Vent().socketIO()

    expect(io).toBeInstanceOf(SocketIOServer)
    void io.close()
  })

  test('uses /socket.io/ as the default path', () => {
    const app = new Vent()
    const io = app.socketIO()

    expect(internals(app).socketIo?.path).toBe('/socket.io/')
    void io.close()
  })

  test('uses a custom path when provided', () => {
    const app = new Vent()
    const io = app.socketIO({ path: '/realtime/' })

    expect(internals(app).socketIo?.path).toBe('/realtime/')
    void io.close()
  })

  test('is idempotent: later calls return the same instance and ignore options', () => {
    const app = new Vent()
    const first = app.socketIO({ path: '/first/' })
    const second = app.socketIO({ path: '/second/' })

    expect(second).toBe(first)
    expect(internals(app).socketIo?.path).toBe('/first/')
    void first.close()
  })

  test('different apps get different Socket.IO servers', () => {
    const a = new Vent().socketIO()
    const b = new Vent().socketIO()

    expect(a).not.toBe(b)
    void a.close()
    void b.close()
  })

  test('stores io, engine and path in the integration', () => {
    const app = new Vent()
    const io = app.socketIO()
    const integration = internals(app).socketIo

    expect(integration?.io).toBe(io)
    expect(integration?.engine).toBeDefined()
    void io.close()
  })
})

// ---------------------------------------------------------------------------
// Modules / DI
// ---------------------------------------------------------------------------

describe('modules()', () => {
  class ModuleA extends DIModule {}
  class ModuleB extends DIModule {}

  test('returns the same instance (chainable)', () => {
    const app = new Vent()

    expect(app.modules([])).toBe(app)
  })

  test('registers the app itself in the container', () => {
    const app = new Vent()
    const set = spyOn(internals(app).container, 'set')

    app.modules([])

    expect(set).toHaveBeenCalledWith(Vent, app)
  })

  test('loads every module in order', () => {
    const app = new Vent()
    const loadedModules: ModuleClass[] = []

    internals(app).moduleLoader.load = (moduleClass) => {
      loadedModules.push(moduleClass as ModuleClass)
    }

    app.modules([ModuleA, ModuleB])

    expect(loadedModules).toEqual([ModuleA, ModuleB])
  })
  test('does not register SocketIOServer when no io is available', () => {
    const app = new Vent()
    const set = spyOn(internals(app).container, 'set')

    app.modules([])

    expect(set).not.toHaveBeenCalledWith(SocketIOServer, expect.anything())
  })

    test('registers the io passed in the context', () => {
    const app = new Vent()
    const io = new SocketIOServer()
    const set = spyOn(internals(app).container, 'set')

    app.modules([], { io })

    expect(set).toHaveBeenCalledWith(SocketIOServer, io)
  })

  test('the context io wins over the one created by socketIO()', async () => {
    const app = new Vent()
    const own = app.socketIO()
    const external = new SocketIOServer()
    const set = spyOn(internals(app).container, 'set')

    app.modules([], { io: external })

    expect(set).toHaveBeenCalledWith(SocketIOServer, external)
    expect(set).not.toHaveBeenCalledWith(SocketIOServer, own)

    await own.close()
  })

})

describe('resolve()', () => {
  test('delegates to the module loader and returns its result', () => {
    class Mod {}
    class Service {}
    const instance = new Service()

    const app = new Vent()
    const resolve = mock(() => instance)
    internals(app).moduleLoader.resolve = resolve

    const result = app.resolve(Mod as never, Service as never)

    expect(resolve).toHaveBeenCalledWith(Mod, Service)
    expect(result).toBe(instance as never)
  })

  test('propagates errors from the module loader', () => {
    const app = new Vent()
    internals(app).moduleLoader.resolve = () => {
      throw new Error('not found')
    }

    expect(() => app.resolve(class {} as never, class {} as never)).toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// listen()
// ---------------------------------------------------------------------------

describe('listen()', () => {
  test('starts a server on the requested port', async () => {
    const app = new Vent().GET('/ping', () => new Response('pong'))
    const server = app.listen(0) as unknown as Listening
    servers.push(server)

    expect(server.port).toBeGreaterThan(0)

    const res = await fetch(`http://localhost:${server.port}/ping`)
    expect(await res.text()).toBe('pong')
  })

  test('two apps can listen at the same time on different ports', async () => {
    const a = new Vent().GET('/id', () => new Response('a'))
    const b = new Vent().GET('/id', () => new Response('b'))
    const baseA = start(a)
    const baseB = start(b)

    expect(await (await fetch(`${baseA}/id`)).text()).toBe('a')
    expect(await (await fetch(`${baseB}/id`)).text()).toBe('b')
  })
})
