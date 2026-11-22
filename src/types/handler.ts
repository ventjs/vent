import type { Context } from './ctx'
import type { Reply } from './reply'

export type ContextHandler = (
  ctx: Context,
  reply: Reply,
) => Response | void | Promise<Response | void>

export type RouteHandler = ContextHandler
