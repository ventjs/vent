import { CookieManager } from '@riser-bob/cookie'
import { ErrorHandler } from '../errors/error-handler'
import type { Context } from '../types/ctx'
import type { ContextMiddleware } from '../types/context-middleware'

export interface VerifiedUser {
  id: string
  [key: string]: unknown
}

export type TokenVerifier = (token: string) => Promise<VerifiedUser | null> | VerifiedUser | null

export type AuthMode = 'cookie' | 'bearer' | 'both'

type CookieAuthOptions = {
  mode: 'cookie'
  cookieName: string
}

type BearerAuthOptions = {
  mode: 'bearer'
}

type BothAuthOptions = {
  mode: 'both'
  cookieName: string
}

export type AuthMiddlewareOptions = CookieAuthOptions | BearerAuthOptions | BothAuthOptions

export class AuthMiddleware {
  private readonly mode: AuthMode
  private readonly cookieName: string

  constructor(
    private readonly verifyToken: TokenVerifier,
    options: AuthMiddlewareOptions = {
      mode: 'both',
      cookieName: 'token',
    },
  ) {
    this.mode = options.mode
    this.cookieName =
      options.mode === 'cookie' || options.mode === 'both' ? options.cookieName : 'token'
  }

  private getToken(ctx: Context): string | null {
    if (this.mode === 'bearer' || this.mode === 'both') {
      const authorization = ctx.headers.get('authorization')

      if (authorization) {
        const match = authorization.match(/^Bearer\s+(\S+)$/i)

        if (!match) return null

        return match[1] ?? null
      }

      if (this.mode === 'bearer') return null
    }

    if (this.mode === 'cookie' || this.mode === 'both') {
      const cookies = CookieManager.fromRequest(ctx.request)

      return cookies.get(this.cookieName) ?? null
    }

    return null
  }

  middleware: ContextMiddleware<Context> = async (ctx, reply, next) => {
    const token = this.getToken(ctx)

    if (!token) {
      return reply.Unauthorized({
        success: false,
        message: 'Authentication token is missing or invalid.',
      })
    }

    let user: VerifiedUser | null

    try {
      user = await this.verifyToken(token)
    } catch (error) {
      console.error('[VentJS] Token verification failed:', error)
      return ErrorHandler.handle(error)
    }

    if (!user) {
      return reply.Unauthorized({
        success: false,
        message: 'Token is invalid or expired.',
      })
    }

    ctx.user = user
    ctx.auth = { token }

    return next()
  }
}
