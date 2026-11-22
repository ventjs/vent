import { describe, expect, it, mock } from 'bun:test'
import { bind, provide } from '../../../src/di/bind'

class Logger {
  log(message: string): string {
    return `logged: ${message}`
  }
}

class ConnectionConfig {
  constructor(
    readonly connection: string,
    readonly poolSize: number,
  ) {}
}

class DatabaseService {
  constructor(readonly config: ConnectionConfig) {}
}

class UsersService {
  constructor(
    readonly logger: Logger,
    readonly database: DatabaseService,
  ) {}
}

describe('provide', () => {
  it('should return a provider with the given token and dependencies', () => {
    const factory = mock((config: ConnectionConfig) => new DatabaseService(config))

    const provider = provide(DatabaseService, [ConnectionConfig], factory)

    expect(provider.token).toBe(DatabaseService)
    expect(provider.deps).toEqual([ConnectionConfig])
  })

  it('should call the factory with resolved dependencies in order', () => {
    const factory = mock((config: ConnectionConfig) => new DatabaseService(config))

    const provider = provide(DatabaseService, [ConnectionConfig], factory)

    const config = new ConnectionConfig('postgres://localhost', 10)
    const result = provider.create([config])

    expect(factory).toHaveBeenCalledWith(config)
    expect(result).toBeInstanceOf(DatabaseService)
    expect(result.config).toBe(config)
  })

  it('should return the factory result', () => {
    const config = new ConnectionConfig('postgres://localhost', 10)
    const expected = new DatabaseService(config)

    const provider = provide(
      DatabaseService,
      [ConnectionConfig],
      (_config: ConnectionConfig) => expected,
    )

    expect(provider.create([config])).toBe(expected)
  })
})

describe('bind', () => {
  it('should use the class as provider token', () => {
    const provider = bind(DatabaseService, ConnectionConfig)

    expect(provider.token).toBe(DatabaseService)
  })

  it('should register constructor dependencies in order', () => {
    const provider = bind(UsersService, Logger, DatabaseService)

    expect(provider.deps).toEqual([Logger, DatabaseService])
  })

  it('should instantiate the class with provided dependencies', () => {
    const logger = new Logger()
    const database = new DatabaseService(new ConnectionConfig('postgres://localhost', 10))

    const provider = bind(UsersService, Logger, DatabaseService)

    const instance = provider.create([logger, database])

    expect(instance).toBeInstanceOf(UsersService)
    expect(instance.logger).toBe(logger)
    expect(instance.database).toBe(database)
  })

  it('should create a new instance on each call', () => {
    const provider = bind(DatabaseService, ConnectionConfig)

    const firstConfig = new ConnectionConfig('connection-1', 5)
    const secondConfig = new ConnectionConfig('connection-2', 10)

    const first = provider.create([firstConfig])
    const second = provider.create([secondConfig])

    expect(first).not.toBe(second)
    expect(first.config).toBe(firstConfig)
    expect(second.config).toBe(secondConfig)
  })
})
