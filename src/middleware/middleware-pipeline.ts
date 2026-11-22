import type { ContextMiddleware, NextFunc } from '../types/context-middleware'
import type { Reply } from '../types/reply'

export class MiddlewarePipeline<Context = unknown> {
  private readonly middlewares: ContextMiddleware<Context>[] = []

  use(middleware: ContextMiddleware<Context>): this {
    this.middlewares.push(middleware)
    return this
  }

  async execute(ctx: Context, reply: Reply, finalHandler: NextFunc): Promise<Response> {
    const middlewares = this.middlewares
    const length = middlewares.length

    // Fast path: no middleware registered.
    if (length === 0) {
      return finalHandler()
    }

    let index = -1

    const dispatch = async (currentIndex: number): Promise<Response> => {
      if (currentIndex <= index) {
        throw new Error('[VentJS] next() called multiple times.')
      }

      index = currentIndex

      if (currentIndex >= length) {
        return finalHandler()
      }

      const middleware = middlewares[currentIndex]!

      return middleware(ctx, reply, () => dispatch(currentIndex + 1))
    }

    return dispatch(0)
  }
}
