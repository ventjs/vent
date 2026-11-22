import { describe, expect, test } from 'bun:test'
import type { Context, ContextHandler, ContextMiddleware, HttpMethod } from '../../../src'
import { RouteGroup } from '../../../src/routing/group'
import { HttpMethodEnum } from '../../../src/types/method'

describe('RouteGroup', () => {
  const createHandler = (): ContextHandler => (() => new Response()) as unknown as ContextHandler

  const createMiddleware = (): ContextMiddleware<Context> =>
    (() => undefined) as unknown as ContextMiddleware<Context>

  function createGroup(prefix = '/api') {
    const calls: {
      method: HttpMethod
      path: string
      handler: ContextHandler
      middlewares: ContextMiddleware<Context>[]
    }[] = []

    const registerRoute = (
      method: HttpMethod,
      path: string,
      handler: ContextHandler,
      ...middlewares: ContextMiddleware<Context>[]
    ): void => {
      calls.push({ method, path, handler, middlewares })
    }

    const group = new RouteGroup(registerRoute, prefix)

    return { group, calls }
  }

  test('should register GET routes with the group prefix', () => {
    const { group, calls } = createGroup()
    const handler = createHandler()

    group.GET('/users', handler)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe(HttpMethodEnum.GET)
    expect(calls[0]!.path).toBe('/api/users')
    expect(calls[0]!.handler).toBe(handler)
  })

  test('should register all supported HTTP methods', () => {
    const { group, calls } = createGroup()
    const handler = createHandler()

    group.GET('/get', handler)
    group.POST('/post', handler)
    group.PUT('/put', handler)
    group.PATCH('/patch', handler)
    group.DELETE('/delete', handler)
    group.HEAD('/head', handler)
    group.OPTIONS('/options', handler)

    expect(calls).toHaveLength(7)

    expect(calls.map((call) => call.method)).toEqual([
      HttpMethodEnum.GET,
      HttpMethodEnum.POST,
      HttpMethodEnum.PUT,
      HttpMethodEnum.PATCH,
      HttpMethodEnum.DELETE,
      HttpMethodEnum.HEAD,
      HttpMethodEnum.OPTIONS,
    ])
  })

  test('should handle root paths without trailing slashes', () => {
    const { group, calls } = createGroup('/api/users')

    group.GET('/', createHandler())

    expect(calls[0]!.path).toBe('/api/users')
  })

  test('should support group middleware through use', () => {
    const { group, calls } = createGroup()
    const middleware = createMiddleware()
    const handler = createHandler()

    group.use(middleware)
    group.GET('/users', handler)

    expect(calls[0]!.middlewares).toEqual([middleware])
  })

  test('should apply route-specific middleware after group middleware', () => {
    const { group, calls } = createGroup()
    const groupMiddleware = createMiddleware()
    const routeMiddleware = createMiddleware()

    group.use(groupMiddleware)
    group.GET('/users', createHandler(), routeMiddleware)

    expect(calls[0]!.middlewares).toEqual([groupMiddleware, routeMiddleware])
  })

  test('should not apply middleware to routes registered before use', () => {
    const { group, calls } = createGroup()
    const middleware = createMiddleware()

    group.GET('/public', createHandler())
    group.use(middleware)
    group.GET('/protected', createHandler())

    expect(calls[0]!.middlewares).toEqual([])
    expect(calls[1]!.middlewares).toEqual([middleware])
  })

  test('should support nested groups and inherit prefixes', () => {
    const { group, calls } = createGroup()

    group.group('/users', (users) => {
      users.GET('/', createHandler())
      users.GET('/:id', createHandler())

      users.group('/posts', (posts) => {
        posts.GET('/', createHandler())
        posts.POST('/', createHandler())
      })
    })

    expect(calls.map((call) => call.path)).toEqual([
      '/api/users',
      '/api/users/:id',
      '/api/users/posts',
      '/api/users/posts',
    ])
  })

  test('should inherit parent and child middlewares in nested groups', () => {
    const { group, calls } = createGroup()

    const parentMiddleware = createMiddleware()
    const childMiddleware = createMiddleware()
    const routeMiddleware = createMiddleware()

    group.use(parentMiddleware)

    group.group('/users', (users) => {
      users.use(childMiddleware)

      users.GET('/', createHandler(), routeMiddleware)
    })

    expect(calls[0]!.middlewares).toEqual([parentMiddleware, childMiddleware, routeMiddleware])
  })

  test('should inherit middleware through multiple nested levels', () => {
    const { group, calls } = createGroup()

    const parentMiddleware = createMiddleware()
    const childMiddleware = createMiddleware()
    const nestedMiddleware = createMiddleware()

    group.use(parentMiddleware)

    group.group('/users', (users) => {
      users.use(childMiddleware)

      users.group('/admin', (admin) => {
        admin.use(nestedMiddleware)
        admin.GET('/dashboard', createHandler())
      })
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.path).toBe('/api/users/admin/dashboard')

    expect(calls[0]!.middlewares).toEqual([parentMiddleware, childMiddleware, nestedMiddleware])
  })

  test('should apply middleware passed directly to group', () => {
    const { group, calls } = createGroup()

    const groupMiddleware = createMiddleware()
    const routeMiddleware = createMiddleware()

    group.group(
      '/admin',
      (admin) => {
        admin.GET('/dashboard', createHandler(), routeMiddleware)
      },
      groupMiddleware,
    )

    expect(calls[0]!.path).toBe('/api/admin/dashboard')
    expect(calls[0]!.middlewares).toEqual([groupMiddleware, routeMiddleware])
  })

  test('should preserve parent middleware when creating nested groups', () => {
    const { group, calls } = createGroup()

    const parentMiddleware = createMiddleware()
    const childMiddleware = createMiddleware()

    group.use(parentMiddleware)

    group.group(
      '/users',
      (users) => {
        users.GET('/', createHandler())
      },
      childMiddleware,
    )

    expect(calls[0]!.middlewares).toEqual([parentMiddleware, childMiddleware])
  })

  test('should return the same group instance for method chaining', () => {
    const { group } = createGroup()

    expect(group.GET('/', createHandler())).toBe(group)
    expect(group.POST('/', createHandler())).toBe(group)
    expect(group.use(createMiddleware())).toBe(group)
    expect(group.group('/users', () => {})).toBe(group)
  })

  test('should reject invalid group prefixes', () => {
    expect(() => createGroup('api')).toThrow()
  })

  test('should reject invalid route paths', () => {
    const { group } = createGroup()

    expect(() => {
      group.GET('users', createHandler())
    }).toThrow()
  })

  test('should reject invalid nested group prefixes', () => {
    const { group } = createGroup()

    expect(() => {
      group.group('users', () => {})
    }).toThrow()
  })
})
