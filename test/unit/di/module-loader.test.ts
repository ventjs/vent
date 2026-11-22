import { describe, expect, it, mock } from 'bun:test'
import { ModuleLoader } from '../../../src/di/module-loader'
import { Container } from '../../../src/di/container'
import { DIModule } from '../../../src/di/module'
import { CircularModuleError } from '../../../src/di/errors'
import { bind } from '../../../src/di/bind'

class Logger {
  log(message: string) {
    return message
  }
}

class UsersService {
  constructor(readonly logger: Logger) {}
}

class UsersController {
  constructor(readonly usersService: UsersService) {}
}

class UsersRouter {
  static registerMock = mock(() => {})

  register() {
    UsersRouter.registerMock()
  }
}

class UsersModule extends DIModule {
  override providers = [Logger, bind(UsersService, Logger)]
  override controllers = [bind(UsersController, UsersService)]
  override routers = [UsersRouter]
  override exports = [UsersService]
}

class PostsService {
  constructor(readonly usersService: UsersService) {}
}

class PostsModule extends DIModule {
  override imports = [UsersModule]
  override providers = [bind(PostsService, UsersService)]
}

describe('ModuleLoader', () => {
  it('should load a module and return its scope', () => {
    const root = new Container()
    const loader = new ModuleLoader(root)

    const scope = loader.load(UsersModule)

    expect(scope).toBeInstanceOf(Container)
    expect(scope.resolve(Logger)).toBeInstanceOf(Logger)
    expect(scope.resolve(UsersService)).toBeInstanceOf(UsersService)
  })

  it('should cache loaded modules', () => {
    const root = new Container()
    const loader = new ModuleLoader(root)

    const first = loader.load(UsersModule)
    const second = loader.load(UsersModule)

    expect(first).toBe(second)
  })

  it('should load imported modules', () => {
    const root = new Container()
    const loader = new ModuleLoader(root)

    const scope = loader.load(PostsModule)

    expect(scope.resolve(PostsService)).toBeInstanceOf(PostsService)
    expect(scope.resolve(PostsService).usersService).toBeInstanceOf(UsersService)
  })

  it('should resolve exported providers from imported modules', () => {
    const root = new Container()
    const loader = new ModuleLoader(root)

    const scope = loader.load(PostsModule)
    const postsService = scope.resolve(PostsService)

    expect(postsService.usersService).toBeInstanceOf(UsersService)
  })

  it('should register and execute module routers', () => {
    UsersRouter.registerMock.mockClear()

    const root = new Container()
    const loader = new ModuleLoader(root)

    loader.load(UsersModule)

    expect(UsersRouter.registerMock).toHaveBeenCalledTimes(1)
  })

  it('should register controllers in the module scope', () => {
    const root = new Container()
    const loader = new ModuleLoader(root)

    const scope = loader.load(UsersModule)

    expect(scope.resolve(UsersController)).toBeInstanceOf(UsersController)
  })

  it('should resolve providers from the root container', () => {
    class RootService {}

    const root = new Container()
    root.register(RootService)

    class FeatureService {
      constructor(readonly rootService: RootService) {}
    }

    class FeatureModule extends DIModule {
      override providers = [bind(FeatureService, RootService)]
    }

    const loader = new ModuleLoader(root)
    const scope = loader.load(FeatureModule)

    expect(scope.resolve(FeatureService).rootService).toBeInstanceOf(RootService)
  })

  it('should throw CircularModuleError for circular module imports', () => {
    class ModuleA extends DIModule {
      override imports = [ModuleB]
    }

    class ModuleB extends DIModule {
      override imports = [ModuleA]
    }

    const root = new Container()
    const loader = new ModuleLoader(root)

    expect(() => loader.load(ModuleA)).toThrow(CircularModuleError)
  })

  it('should create independent scopes for different modules', () => {
    class ModuleA extends DIModule {
      override providers = [Logger]
    }

    class ModuleB extends DIModule {
      override providers = [Logger]
    }

    const root = new Container()
    const loader = new ModuleLoader(root)

    const scopeA = loader.load(ModuleA)
    const scopeB = loader.load(ModuleB)

    expect(scopeA).not.toBe(scopeB)
    expect(scopeA.resolve(Logger)).not.toBe(scopeB.resolve(Logger))
  })
})
