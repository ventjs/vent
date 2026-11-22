import type { NextFunc } from '../types/context-middleware'
import type { Context } from '../types/ctx'
import type { Reply } from '../types/reply'

const colors = {
  reset: '\x1b[0m',
  darkBlue: '\x1b[34m',
  cyan: '\x1b[96m',
}

export const createLoggerMiddleware = () => {
  return async (ctx: Context, reply: Reply, next: NextFunc): Promise<Response> => {
    const startTime = performance.now()
    let statusCode = 500

    try {
      const response = await next()
      statusCode = response.status
      return response
    } catch (error) {
      console.log('[VentJS] Request failed.', error)
      throw error
    } finally {
      const duration = (performance.now() - startTime).toFixed(2)
      const timestamp = new Date().toISOString()

      const { reset, darkBlue, cyan } = colors

      console.log(
        `${darkBlue}[VentJS] ${timestamp} | ${ctx.method}${reset} ` +
          `${cyan}${ctx.path} | ${statusCode} | ${duration}ms${reset}`,
      )
    }
  }
}

export const loggerMiddleware = createLoggerMiddleware()
