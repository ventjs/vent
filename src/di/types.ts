/**
 * Any class, abstract ones included. `never[]` makes every constructor
 * assignable (parameters are contravariant), so no `any` is needed.
 */
export type Token<T = unknown> = abstract new (...args: never[]) => T

/** Maps a constructor's parameter tuple to the tuple of tokens that satisfy it. */
export type Deps<A extends readonly unknown[]> = { [K in keyof A]: Token<A[K]> }

export interface Provider<T = unknown> {
  readonly token: Token<T>
  readonly deps: readonly Token[]
  readonly create: (args: readonly unknown[]) => T
}

/** A provider, or a class with no constructor dependencies. */
export type Registrable<T = unknown> = Provider<T> | (new () => T)

export function isProvider<T>(value: Registrable<T>): value is Provider<T> {
  return typeof value === 'object'
}

export function tokenOf<T>(value: Registrable<T>): Token<T> {
  return isProvider(value) ? value.token : value
}
