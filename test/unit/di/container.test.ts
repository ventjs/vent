import { describe, expect, it } from 'bun:test'
import { Container } from '../../../src/di/container'
import { bind } from '../../../src/di/bind'
import {
  CircularDependencyError,
  DuplicateProviderError,
  InvalidExportError,
  ProviderNotFoundError,
} from '../../../src/di/errors'

class Logger {
  log(message: string) {
    return `logged: ${message}`
  }
}

class DatabaseService {
  constructor(readonly connection = 'postgres://localhost') {}
}

class UsersService {
  constructor(
    readonly logger: Logger,
    readonly database: DatabaseService,
  ) {}
}

class UnknownService {}

describe('Container', () => {
  describe('register', () => {
    it('should register a custom provider', () => {
      const container = new Container()
      const provider = bind(UsersService, Logger, DatabaseService)

      container.register(Logger)
      container.register(DatabaseService)
      container.register(provider)

      const usersService = container.resolve(UsersService)

      expect(usersService).toBeInstanceOf(UsersService)
      expect(usersService.logger).toBeInstanceOf(Logger)
      expect(usersService.database).toBeInstanceOf(DatabaseService)
    })

    it('should throw DuplicateProviderError when registering the same provider twice', () => {
      const container = new Container()

      container.register(Logger)

      expect(() => container.register(Logger)).toThrow(DuplicateProviderError)
    })
  })

  describe('set', () => {
    it('should register an already-built instance', () => {
      const container = new Container()
      const logger = new Logger()

      container.set(Logger, logger)

      expect(container.resolve(Logger)).toBe(logger)
    })

    it('should return the registered instance before resolving its provider', () => {
      const container = new Container()
      const logger = new Logger()

      container.register(Logger)
      container.set(Logger, logger)

      expect(container.resolve(Logger)).toBe(logger)
    })
  })

  describe('resolve', () => {
    it('should resolve a provider dependency', () => {
      const container = new Container()

      container.register(Logger)
      container.register(DatabaseService)
      container.register(bind(UsersService, Logger, DatabaseService))

      const usersService = container.resolve(UsersService)

      expect(usersService).toBeInstanceOf(UsersService)
      expect(usersService.logger).toBeInstanceOf(Logger)
      expect(usersService.database).toBeInstanceOf(DatabaseService)
    })

    it('should resolve dependencies in the correct order', () => {
      const container = new Container()

      container.register(Logger)
      container.register(DatabaseService)
      container.register(bind(UsersService, Logger, DatabaseService))

      const usersService = container.resolve(UsersService)

      expect(usersService.logger).toBeInstanceOf(Logger)
      expect(usersService.database).toBeInstanceOf(DatabaseService)
    })

    it('should return the same instance on repeated resolutions', () => {
      const container = new Container()

      container.register(Logger)

      const first = container.resolve(Logger)
      const second = container.resolve(Logger)

      expect(first).toBe(second)
    })

    it('should throw ProviderNotFoundError when the provider does not exist', () => {
      const container = new Container()

      expect(() => container.resolve(UnknownService)).toThrow(ProviderNotFoundError)
    })

    it('should throw ProviderNotFoundError when a dependency is missing', () => {
      const container = new Container()

      container.register(bind(UsersService, Logger, DatabaseService))

      expect(() => container.resolve(UsersService)).toThrow(ProviderNotFoundError)
    })
  })

  describe('import and export', () => {
    it('should resolve an exported provider from an imported scope', () => {
      const source = new Container()
      const consumer = new Container()

      source.register(Logger)
      source.export(Logger)

      consumer.import(source)

      expect(consumer.resolve(Logger)).toBeInstanceOf(Logger)
    })

    it('should not resolve a provider that was not exported', () => {
      const source = new Container()
      const consumer = new Container()

      source.register(Logger)
      consumer.import(source)

      expect(() => consumer.resolve(Logger)).toThrow(ProviderNotFoundError)
    })

    it('should export an already-registered instance', () => {
      const source = new Container()
      const consumer = new Container()
      const logger = new Logger()

      source.set(Logger, logger)
      source.export(Logger)

      consumer.import(source)

      expect(consumer.resolve(Logger)).toBe(logger)
    })

    it('should throw InvalidExportError when exporting an unknown provider', () => {
      const container = new Container()

      expect(() => container.export(UnknownService)).toThrow(InvalidExportError)
    })

    it('should resolve a provider from an imported scope only when exported', () => {
      const source = new Container()
      const consumer = new Container()

      source.register(Logger)
      source.register(DatabaseService)

      source.export(Logger)
      consumer.import(source)

      expect(consumer.resolve(Logger)).toBeInstanceOf(Logger)
      expect(() => consumer.resolve(DatabaseService)).toThrow(ProviderNotFoundError)
    })
  })

  describe('parent scope', () => {
    it('should resolve a provider from the parent container', () => {
      const parent = new Container()
      const child = new Container(parent)

      parent.register(Logger)

      expect(child.resolve(Logger)).toBeInstanceOf(Logger)
    })

    it('should resolve dependencies from the parent container', () => {
      const parent = new Container()
      const child = new Container(parent)

      parent.register(Logger)
      parent.register(DatabaseService)

      child.register(bind(UsersService, Logger, DatabaseService))

      const usersService = child.resolve(UsersService)

      expect(usersService.logger).toBeInstanceOf(Logger)
      expect(usersService.database).toBeInstanceOf(DatabaseService)
    })

    it('should prefer a local provider over a parent provider', () => {
      const parent = new Container()
      const child = new Container(parent)

      parent.register(Logger)
      child.register(Logger)

      const parentLogger = parent.resolve(Logger)
      const childLogger = child.resolve(Logger)

      expect(childLogger).not.toBe(parentLogger)
    })
  })

  describe('circular dependencies', () => {
    it('should throw CircularDependencyError for direct circular dependencies', () => {
      class ServiceA {
        constructor(readonly serviceB: ServiceB) {}
      }

      class ServiceB {
        constructor(readonly serviceA: ServiceA) {}
      }

      const container = new Container()

      container.register(bind(ServiceA, ServiceB))
      container.register(bind(ServiceB, ServiceA))

      expect(() => container.resolve(ServiceA)).toThrow(CircularDependencyError)
    })

    it('should detect circular dependencies across imported scopes', () => {
      class ServiceA {
        constructor(readonly serviceB: ServiceB) {}
      }

      class ServiceB {
        constructor(readonly serviceA: ServiceA) {}
      }

      const scopeA = new Container()
      const scopeB = new Container()

      scopeA.register(bind(ServiceA, ServiceB))
      scopeB.register(bind(ServiceB, ServiceA))

      scopeA.import(scopeB)
      scopeB.import(scopeA)

      scopeA.export(ServiceA)
      scopeB.export(ServiceB)

      expect(() => scopeA.resolve(ServiceA)).toThrow(CircularDependencyError)
    })
  })
})
