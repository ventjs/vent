import type { AuthToken } from './auth-token'

export interface AuthenticationUser {
  id: string
  [key: string]: unknown
}

export interface Context<TUser extends AuthenticationUser = AuthenticationUser> {
  readonly request: Request
  readonly method: string
  readonly url: URL
  readonly path: string
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  readonly headers: Headers

  user?: TUser
  auth?: AuthToken

  json<T = unknown>(): Promise<T>
  formData(): ReturnType<Response['formData']>
  text(): Promise<string>
}
