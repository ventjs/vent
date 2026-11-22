import type { Reply } from './reply'

export type NextFunc = () => Promise<Response>

export type ContextMiddleware<Context = unknown> = (
  ctx: Context,
  reply: Reply,
  next: NextFunc,
) => Response | Promise<Response>
