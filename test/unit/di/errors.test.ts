import { describe, expect, it } from 'bun:test'
import {
  DIError,
  ProviderNotFoundError,
  CircularDependencyError,
  DuplicateProviderError,
  InvalidExportError,
  CircularModuleError,
} from '../../../src/di/errors'

class UsersService {}
class PostsService {}
class AuthService {}

describe('DIError', () => {
  it('should extend the native Error class', () => {
    const error = new DIError('Test error')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DIError)
  })

  it('should prefix messages with [VentJS]', () => {
    const error = new DIError('Test error')

    expect(error.message).toBe('[VentJS] Test error')
  })

  it('should use the actual class name as error name', () => {
    const error = new DIError('Test error')

    expect(error.name).toBe('DIError')
  })
})

describe('ProviderNotFoundError', () => {
  it('should identify the missing provider', () => {
    const error = new ProviderNotFoundError(UsersService, [])

    expect(error).toBeInstanceOf(DIError)
    expect(error.name).toBe('ProviderNotFoundError')
    expect(error.message).toContain('UsersService')
  })

  it('should include the dependency chain', () => {
    const error = new ProviderNotFoundError(AuthService, [UsersService, PostsService])

    expect(error.message).toContain('AuthService')
    expect(error.message).toContain('UsersService -> PostsService')
  })

  it('should support an empty dependency chain', () => {
    const error = new ProviderNotFoundError(UsersService, [])

    expect(error).toBeInstanceOf(ProviderNotFoundError)
    expect(error.message).toContain('UsersService')
  })
})

describe('CircularDependencyError', () => {
  it('should identify the circular dependency chain', () => {
    const error = new CircularDependencyError([
      UsersService,
      PostsService,
      AuthService,
      UsersService,
    ])

    expect(error).toBeInstanceOf(DIError)
    expect(error.name).toBe('CircularDependencyError')
    expect(error.message).toContain('UsersService -> PostsService -> AuthService -> UsersService')
  })

  it('should support a single token', () => {
    const error = new CircularDependencyError([UsersService])

    expect(error.message).toContain('UsersService')
  })
})

describe('DuplicateProviderError', () => {
  it('should identify the duplicated provider', () => {
    const error = new DuplicateProviderError(UsersService)

    expect(error).toBeInstanceOf(DIError)
    expect(error.name).toBe('DuplicateProviderError')
    expect(error.message).toContain('UsersService')
  })
})

describe('InvalidExportError', () => {
  it('should identify the invalid export token', () => {
    const error = new InvalidExportError(PostsService)

    expect(error).toBeInstanceOf(DIError)
    expect(error.name).toBe('InvalidExportError')
    expect(error.message).toContain('PostsService')
  })
})

describe('CircularModuleError', () => {
  it('should identify the circular module chain', () => {
    const error = new CircularModuleError([
      { name: 'UsersModule' },
      { name: 'PostsModule' },
      { name: 'AuthModule' },
      { name: 'UsersModule' },
    ])

    expect(error).toBeInstanceOf(DIError)
    expect(error.name).toBe('CircularModuleError')
    expect(error.message).toContain('UsersModule -> PostsModule -> AuthModule -> UsersModule')
  })

  it('should support an empty module chain', () => {
    const error = new CircularModuleError([])

    expect(error).toBeInstanceOf(CircularModuleError)
  })
})
