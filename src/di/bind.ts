import type { Deps, Provider, Token } from './types'

/**
 * Registers a provider built by a custom factory.
 * `A` is inferred from the factory, so the dependency tokens are type-checked.
 */
export function provide<T, A extends readonly unknown[]>(
  token: Token<T>,
  deps: Deps<A>,
  factory: (...args: A) => T,
): Provider<T> {
  return {
    token,
    deps: deps as readonly Token[],
    // The container resolves `deps` in order, so `args` always matches `A`.
    create: (args) => factory(...(args as A)),
  }
}

/**
 * Binds a class to the tokens of its constructor dependencies.
 * A wrong type, count or order is a compile-time error.
 */
export function bind<T, A extends readonly unknown[]>(
  cls: new (...args: A) => T,
  ...deps: Deps<A>
): Provider<T> {
  // A generic `A` can't be proven assignable to `never[]`, though any concrete one is.
  return provide(cls as unknown as Token<T>, deps, (...args: A) => new cls(...args))
}
