import { createAuthProvider } from './auth-provider'
import { Container } from './container'
import { CircularModuleError } from './errors'
import type { ModuleClass } from './module'
import { tokenOf, type Token } from './types'

export class ModuleLoader {
  private readonly scopes = new Map<ModuleClass, Container>()
  private readonly loading: ModuleClass[] = []

  constructor(private readonly root: Container) {}

  load(moduleClass: ModuleClass): Container {
    const cached = this.scopes.get(moduleClass)
    if (cached) return cached

    if (this.loading.includes(moduleClass)) {
      throw new CircularModuleError([...this.loading, moduleClass])
    }

    this.loading.push(moduleClass)
    try {
      const scope = this.build(moduleClass)
      this.scopes.set(moduleClass, scope)
      return scope
    } finally {
      this.loading.pop()
    }
  }

  resolve<T>(moduleClass: ModuleClass, token: Token<T>): T {
    const scope = this.scopes.get(moduleClass)

    if (!scope) {
      throw new Error(`Module "${moduleClass.name}" has not been loaded`)
    }

    return scope.resolve(token)
  }

  private build(moduleClass: ModuleClass): Container {
    const definition = new moduleClass()
    const scope = new Container(this.root)

    for (const imported of definition.imports) {
      scope.import(this.load(imported))
    }

    for (const registrable of [
      ...definition.providers,
      ...definition.controllers,
      ...definition.routers,
    ]) {
      scope.register(registrable)
    }

    if (definition.auth) {
      scope.register(createAuthProvider(definition.auth))
    }

    for (const token of definition.exports) {
      scope.export(token)
    }

    for (const router of definition.routers) {
      scope.resolve(tokenOf(router)).register()
    }

    return scope
  }
}
