import { describe, expect, it } from 'bun:test'
import { defineAuth, DIModule, type AuthConfig, type Routable } from '../../../src/di/module'

class TokenVerifier {
  verifyToken(token: string) {
    return { id: token }
  }
}

class UsersService {}

class UsersRouter implements Routable {
  register() {}
}

describe('defineAuth', () => {
  it('should return the provided auth configuration', () => {
    const config: AuthConfig = {
      verifier: TokenVerifier,
      mode: 'bearer',
    }

    expect(defineAuth(config)).toBe(config)
  })

  it('should preserve bearer authentication configuration', () => {
    const config = defineAuth({
      verifier: TokenVerifier,
      mode: 'bearer',
    })

    expect(config).toEqual({
      verifier: TokenVerifier,
      mode: 'bearer',
    })
  })

  it('should preserve cookie authentication configuration', () => {
    const config = defineAuth({
      verifier: TokenVerifier,
      mode: 'cookie',
      cookieName: 'session',
    })

    expect(config).toEqual({
      verifier: TokenVerifier,
      mode: 'cookie',
      cookieName: 'session',
    })
  })

  it('should preserve both authentication configuration', () => {
    const config = defineAuth({
      verifier: TokenVerifier,
      mode: 'both',
      cookieName: 'auth_token',
    })

    expect(config).toEqual({
      verifier: TokenVerifier,
      mode: 'both',
      cookieName: 'auth_token',
    })
  })
})

describe('module', () => {
  it('should initialize with empty module metadata', () => {
    class TestModule extends DIModule {}

    const module = new TestModule()

    expect(module.imports).toEqual([])
    expect(module.providers).toEqual([])
    expect(module.controllers).toEqual([])
    expect(module.routers).toEqual([])
    expect(module.exports).toEqual([])
    expect(module.auth).toBeUndefined()
  })

  it('should preserve configured module metadata', () => {
    class TestModule extends DIModule {
      override providers = [UsersService]
      override routers = [UsersRouter]
      override exports = [UsersService]
    }

    const module = new TestModule()

    expect(module.providers).toEqual([UsersService])
    expect(module.routers).toEqual([UsersRouter])
    expect(module.exports).toEqual([UsersService])
  })

  it('should preserve imported modules', () => {
    class UsersModule extends DIModule {}

    class PostsModule extends DIModule {
      override imports = [UsersModule]
    }

    const module = new PostsModule()

    expect(module.imports).toEqual([UsersModule])
  })

  it('should preserve auth configuration', () => {
    class TestModule extends DIModule {
      override auth = defineAuth({
        verifier: TokenVerifier,
        mode: 'bearer',
      })
    }

    const module = new TestModule()

    expect(module.auth).toEqual({
      verifier: TokenVerifier,
      mode: 'bearer',
    })
  })

  it('should create independent metadata arrays for separate module instances when overridden', () => {
    class TestModule extends DIModule {
      override providers = [UsersService]
    }

    const first = new TestModule()
    const second = new TestModule()

    expect(first.providers).not.toBe(second.providers)
    expect(first.providers).toEqual(second.providers)
  })
})
