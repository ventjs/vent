import type { AuthMiddlewareOptions, TokenVerifier } from '../middleware/auth-middleware'
import type { Registrable, Token } from './types'

export interface Routable {
  register(): void
}

/** Anything exposing `verifyToken` with the same contract as AuthMiddleware's verifier. */
export interface TokenVerifierSource {
  verifyToken(token: string): ReturnType<TokenVerifier>
}

/** Same shape as AuthMiddlewareOptions, plus the class that verifies tokens. */
export type AuthConfig = AuthMiddlewareOptions & {
  readonly verifier: Token<TokenVerifierSource>
}

export function defineAuth(config: AuthConfig): AuthConfig {
  return config
}

export type ModuleClass = new () => DIModule

export abstract class DIModule {
  readonly imports: readonly ModuleClass[] = []
  readonly providers: readonly Registrable[] = []
  readonly controllers: readonly Registrable[] = []
  readonly routers: readonly Registrable<Routable>[] = []
  readonly exports: readonly Token[] = []
  readonly auth?: AuthConfig
}
