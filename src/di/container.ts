import { bind } from './bind'
import {
  CircularDependencyError,
  DuplicateProviderError,
  InvalidExportError,
  ProviderNotFoundError,
} from './errors'
import { isProvider, type Provider, type Registrable, type Token } from './types'

export class Container {
  private readonly instances = new Map<Token, unknown>()
  private readonly providers = new Map<Token, Provider>()
  private readonly imports: Container[] = []
  private readonly exported = new Set<Token>()
  /** Shared across every scope so cycles are detected across module boundaries. */
  private readonly resolving: Token[]

  constructor(private readonly parent?: Container) {
    this.resolving = parent?.resolving ?? []
  }

  register<T>(registrable: Registrable<T>): void {
    const provider = isProvider(registrable) ? registrable : bind(registrable)

    if (this.providers.has(provider.token)) {
      throw new DuplicateProviderError(provider.token)
    }
    this.providers.set(provider.token, provider)
  }

  /** Registers an already-built value (e.g. VentJS, socket.io Server). */
  set<T>(token: Token<T>, value: T): void {
    this.instances.set(token, value)
  }

  import(scope: Container): void {
    this.imports.push(scope)
  }

  export(token: Token): void {
    if (!this.provides(token)) throw new InvalidExportError(token)
    this.exported.add(token)
  }

  resolve<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T

    const provider = this.providers.get(token)
    if (provider) return this.instantiate(provider) as T

    for (const scope of this.imports) {
      if (scope.exported.has(token)) return scope.resolve(token)
    }

    if (this.parent) return this.parent.resolve(token)

    throw new ProviderNotFoundError(token, this.resolving)
  }

  private provides(token: Token): boolean {
    return (
      this.instances.has(token) ||
      this.providers.has(token) ||
      this.imports.some((scope) => scope.exported.has(token))
    )
  }

  private instantiate<T>(provider: Provider<T>): T {
    if (this.resolving.includes(provider.token)) {
      throw new CircularDependencyError([...this.resolving, provider.token])
    }

    this.resolving.push(provider.token)
    try {
      const args = provider.deps.map((dep) => this.resolve(dep))
      const instance = provider.create(args)
      this.instances.set(provider.token, instance)
      return instance
    } finally {
      this.resolving.pop()
    }
  }
}
