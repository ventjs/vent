import { AuthMiddleware, type AuthMiddlewareOptions } from '../middleware/auth-middleware'
import { provide } from './bind'
import type { AuthConfig, TokenVerifierSource } from './module'
import type { Provider } from './types'

function toMiddlewareOptions(config: AuthConfig): AuthMiddlewareOptions {
  switch (config.mode) {
    case 'cookie':
      return { mode: 'cookie', cookieName: config.cookieName }
    case 'bearer':
      return { mode: 'bearer' }
    case 'both':
      return { mode: 'both', cookieName: config.cookieName }
  }
}

export function createAuthProvider(config: AuthConfig): Provider<AuthMiddleware> {
  const options = toMiddlewareOptions(config)

  return provide(
    AuthMiddleware,
    [config.verifier],
    (source: TokenVerifierSource) =>
      // Arrow keeps `this` bound to the verifier instance.
      new AuthMiddleware((token) => source.verifyToken(token), options),
  )
}
