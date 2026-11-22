import { Router } from '../routing/router'
import { MiddlewarePipeline } from '../middleware/middleware-pipeline'
import { HttpServer } from '../server/http-server'
import { HttpError } from '../errors/http-error'
import { Server as SocketIOServer } from 'socket.io'
import type { ServerOptions } from 'socket.io'
import { Server as BunSocketEngine } from '@socket.io/bun-engine'
import type { SocketIOIntegration } from '../types/socket-io-integration'
import type { RegisteredRoute } from '../types/registered-route'
import { ModuleLoader } from '../di/module-loader'
import { Container } from '../di/container'
import type { Token } from '../di/types'
import type { ModuleClass } from '../di/module'
import type { Context } from '../types/ctx'
import type { ContextMiddleware } from '../types/context-middleware'
import { HttpMethodEnum, type HttpMethod } from '../types/method'
import type { ContextHandler } from '../types/handler'
import { RouteGroup } from '../routing/group'

export class Vent {
  private readonly router: Router
  private readonly middlewares: ContextMiddleware<Context>[] = []
  private socketIo?: SocketIOIntegration
  private readonly container = new Container()
  private readonly moduleLoader = new ModuleLoader(this.container)
  constructor() {
    this.router = new Router()
  }

  private register(
    method: HttpMethod,
    path: string,
    handler: ContextHandler,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    if (!path.startsWith('/')) {
      throw new Error(`Invalid path "${path}". The path must start with "/".`)
    }

    const pipeline = new MiddlewarePipeline<Context>()

    for (const middleware of this.middlewares) {
      pipeline.use(middleware)
    }

    for (const middleware of middlewares) {
      pipeline.use(middleware)
    }

    const wrappedHandler: ContextHandler = async (ctx, reply) => {
      return pipeline.execute(ctx, reply, async (): Promise<Response> => {
        const result = await handler(ctx, reply)

        if (result instanceof Response) {
          return result
        }

        console.error('[VentJS] Handler did not return a Response.')

        throw new HttpError(500, 'Handler did not send a response')
      })
    }

    this.router.register(method, path, wrappedHandler)

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

  readRoutes(): readonly RegisteredRoute[] {
    return this.router.list()
  }

  use(middleware: ContextMiddleware<Context>): this {
    this.middlewares.push(middleware)
    return this
  }

  socketIO(options: Partial<ServerOptions> = {}): SocketIOServer {
    if (this.socketIo) {
      return this.socketIo.io
    }

    const path = options.path ?? '/socket.io/'

    const engine = new BunSocketEngine({ path })
    const io = new SocketIOServer({
      ...options,
      path,
    })

    io.bind(engine)

    this.socketIo = {
      io,
      engine,
      path,
    }

    return io
  }

  group(
    prefix: string,
    callback: (group: RouteGroup) => void,
    ...middlewares: ContextMiddleware<Context>[]
  ): this {
    const group = new RouteGroup(
      (method, path, handler, ...routeMiddlewares) => {
        this.register(method, path, handler, ...routeMiddlewares)
      },
      prefix,
      middlewares,
    )

    callback(group)

    return this
  }

  modules(modules: readonly ModuleClass[], context: { readonly io?: SocketIOServer } = {}): this {
    const io = context.io ?? this.socketIo?.io

    this.container.set(Vent, this)

    if (io) this.container.set(SocketIOServer, io)

    for (const moduleClass of modules) {
      this.moduleLoader.load(moduleClass)
    }

    return this
  }

  resolve<T>(moduleClass: ModuleClass, token: Token<T>): T {
    return this.moduleLoader.resolve(moduleClass, token)
  }

  listen(port = 4000, callback?: () => void) {
    return HttpServer(this.router, port, callback, this.socketIo)
  }
}
