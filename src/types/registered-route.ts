import type { HttpMethod } from './method'

export interface RegisteredRoute {
  readonly method: HttpMethod
  readonly path: string
}
