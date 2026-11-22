import { HttpMethodEnum, type HttpMethod } from '../types/method'
import type { ContextHandler } from '../types/handler'
import type { ContextMiddleware } from '../types/context-middleware'
import type { Context } from '../types/ctx'

type RouteRegistrar = (
  method: HttpMethod,
  path: string,
  handler: ContextHandler,
  ...middlewares: ContextMiddleware<Context>[]
) => void

function joinPaths(prefix: string, path: string): string {
  if (!prefix.startsWith('/')) {
    throw new Error(`Invalid path: ${prefix}. Paths must start with '/'`)
  }

  if (!path.startsWith('/')) {
    throw new Error(`Invalid path: ${prefix}. Paths must start with '/'`)
  }

  const base = prefix === '/' ? '' : prefix.replace(/\/+$/, '')
  const segment = path.replace(/^\/+/, '')

  return segment ? `${base}/${segment}` : base || '/'
}

export class RouteGroup {
  constructor(
    private readonly registerRoute: RouteRegistrar,
    private readonly prefix: string,
    private readonly middlewares: ContextMiddleware<Context>[] = [],
  ) {
    if (!prefix.startsWith('/')) {
      throw new Error(`Invalid path: ${prefix}. Paths must start with '/'`)
    }
  }

  private register(
    method: HttpMethod,
    path: string,
    handler: ContextHandler,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    const fullPath = joinPaths(this.prefix, path)

    this.registerRoute(method, fullPath, handler, ...this.middlewares, ...middlewares)

    return this
  }

  GET(path: string, handler: ContextHandler, ...middlewares: ContextMiddleware<Context>[]): this {
    return this.register(HttpMethodEnum.GET, path, handler, ...middlewares)
  }

  POST(path: string, handler: ContextHandler, ...middlewares: ContextMiddleware<Context>[]): this {
    return this.register(HttpMethodEnum.POST, path, handler, ...middlewares)
  }

  PUT(path: string, handler: ContextHandler, ...middlewares: ContextMiddleware<Context>[]): this {
    return this.register(HttpMethodEnum.PUT, path, handler, ...middlewares)
  }

  PATCH(path: string, handler: ContextHandler, ...middlewares: ContextMiddleware<Context>[]): this {
    return this.register(HttpMethodEnum.PATCH, path, handler, ...middlewares)
  }

  DELETE(
    path: string,
    handler: ContextHandler,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    return this.register(HttpMethodEnum.DELETE, path, handler, ...middlewares)
  }

  HEAD(path: string, handler: ContextHandler, ...middlewares: ContextMiddleware<Context>[]): this {
    return this.register(HttpMethodEnum.HEAD, path, handler, ...middlewares)
  }

  OPTIONS(
    path: string,
    handler: ContextHandler,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    return this.register(HttpMethodEnum.OPTIONS, path, handler, ...middlewares)
  }

  use(middleware: ContextMiddleware<Context>): this {
    this.middlewares.push(middleware)
    return this
  }

  group(
    prefix: string,
    callback: (group: RouteGroup) => void,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    const fullPrefix = joinPaths(this.prefix, prefix)

    const nestedGroup = new RouteGroup(this.registerRoute, fullPrefix, [
      ...this.middlewares,
      ...middlewares,
    ])

    callback(nestedGroup)

    return this
  }
}
