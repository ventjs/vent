import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { restGenerateModule } from '../../../../cli/generators/rest-module.generator'

// The generator works relative to `process.cwd()`, so every test runs inside a fresh temporary
// directory. `process.chdir` is global: do not run this file with `--concurrent`.

interface Spy {
  mockRestore(): void
  mock: { calls: unknown[][] }
}

let originalCwd: string
let workspace: string
let logSpy: Spy

beforeEach(async () => {
  originalCwd = process.cwd()
  workspace = await mkdtemp(path.join(tmpdir(), 'vent-rest-generator-'))
  process.chdir(workspace)
  logSpy = spyOn(console, 'log').mockImplementation(() => {}) as unknown as Spy
})

afterEach(async () => {
  logSpy.mockRestore()
  process.chdir(originalCwd)
  await rm(workspace, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Always resolved from the real cwd (macOS reports /private/var for temp directories). */
const moduleDir = (moduleName: string): string =>
  path.join(process.cwd(), 'src', 'modules', moduleName)

const exists = (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false,
  )

const read = (moduleName: string, relativePath: string): Promise<string> =>
  readFile(path.join(moduleDir(moduleName), relativePath), 'utf8')

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []

  for await (const file of new Bun.Glob('**/*').scan({ cwd: directory, onlyFiles: true })) {
    files.push(file.replaceAll('\\', '/'))
  }

  return files.sort()
}

const output = (): string => logSpy.mock.calls.map((call) => call.join(' ')).join('\n')

const BASE_FILES = [
  'users.controller.ts',
  'users.route.ts',
  'users.module.ts',
  'schemas/user.schema.ts',
  'rules/create.ts',
  'rules/update.ts',
  'tests/users.controller.test.ts',
]

// ---------------------------------------------------------------------------
// Module name validation
// ---------------------------------------------------------------------------

describe('restGenerateModule: module name validation', () => {
  const invalidNames = [
    '',
    '1users',
    '-users',
    '_users',
    'user name',
    'users!',
    '../escape',
    'users/admin',
    'users.v2',
    'مستخدمين',
  ]

  for (const name of invalidNames) {
    test(`rejects ${JSON.stringify(name)} and creates nothing`, async () => {
      await expect(restGenerateModule(name)).rejects.toThrow('Invalid module name')

      expect(await exists(path.join(process.cwd(), 'src'))).toBe(false)
    })
  }

  for (const name of ['users', 'user_profiles', 'Users-2', 'a', 'blogPosts']) {
    test(`accepts ${JSON.stringify(name)}`, async () => {
      await expect(restGenerateModule(name)).resolves.toBeUndefined()
    })
  }
})

// ---------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------

describe('restGenerateModule: generated files', () => {
  test('creates the base files without a service by default', async () => {
    await restGenerateModule('users')

    expect(await listFiles(moduleDir('users'))).toEqual([...BASE_FILES].sort())
  })

  test('creates the same files when withService is explicitly false', async () => {
    await restGenerateModule('users', false)

    expect(await listFiles(moduleDir('users'))).toEqual([...BASE_FILES].sort())
  })

  test('adds the service and its test when withService is true', async () => {
    await restGenerateModule('users', true)

    expect(await listFiles(moduleDir('users'))).toEqual(
      [...BASE_FILES, 'users.service.ts', 'tests/users.service.test.ts'].sort(),
    )
  })

  test('creates src/modules recursively when it does not exist', async () => {
    expect(await exists(path.join(process.cwd(), 'src'))).toBe(false)

    await restGenerateModule('users')

    expect(await exists(moduleDir('users'))).toBe(true)
  })

  test('every generated .ts file is valid TypeScript', async () => {
    for (const withService of [false, true]) {
      const name = withService ? 'orders' : 'invoices'
      await restGenerateModule(name, withService)

      const transpiler = new Bun.Transpiler({ loader: 'ts' })
      const failures: string[] = []

      for (const file of await listFiles(moduleDir(name))) {
        const source = await read(name, file)

        try {
          transpiler.transformSync(source)
        } catch (error) {
          failures.push(`${name}/${file}: ${String(error)}`)
        }
      }

      expect(failures).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

describe('restGenerateModule: naming', () => {
  const normalized: Array<[input: string, directory: string]> = [
    ['users', 'users'],
    ['Users', 'users'],
    ['UserProfiles', 'user-profiles'],
    ['user_profiles', 'user-profiles'],
    ['USER_PROFILES', 'user-profiles'],
    ['blogPosts', 'blog-posts'],
  ]

  for (const [input, directory] of normalized) {
    test(`"${input}" becomes the "${directory}" module`, async () => {
      await restGenerateModule(input)

      expect(await exists(path.join(moduleDir(directory), `${directory}.controller.ts`))).toBe(true)
      expect(await exists(path.join(moduleDir(directory), `${directory}.module.ts`))).toBe(true)
    })
  }

  test('uses PascalCase classes and camelCase variables for multi-word names', async () => {
    await restGenerateModule('user-profiles', true)

    const controller = await read('user-profiles', 'user-profiles.controller.ts')
    const controllerTest = await read('user-profiles', 'tests/user-profiles.controller.test.ts')

    expect(controller).toContain('export class UserProfilesController')
    expect(controller).toContain(
      'constructor(private readonly userProfilesService: UserProfilesService) {}',
    )
    expect(controllerTest).toContain(
      'const userProfilesController = new UserProfilesController(new UserProfilesService())',
    )
  })

  test('derives the singular schema name from a plural module name', async () => {
    await restGenerateModule('users')

    expect(await read('users', 'schemas/user.schema.ts')).toContain('export class UserSchema {}')
    expect(await read('users', 'rules/create.ts')).toContain('export const CreateUserRule')
    expect(await read('users', 'rules/update.ts')).toContain('export const UpdateUserRule')
  })

  test('turns "ies" into "y" for the singular name', async () => {
    await restGenerateModule('categories')

    expect(await exists(path.join(moduleDir('categories'), 'schemas/category.schema.ts'))).toBe(
      true,
    )
    expect(await read('categories', 'schemas/category.schema.ts')).toContain('CategorySchema')
  })

  test('keeps a name ending in "ss" as is', async () => {
    await restGenerateModule('address')

    expect(await read('address', 'schemas/address.schema.ts')).toContain('AddressSchema')
  })

  test('uses the singular name for multi-word schemas', async () => {
    await restGenerateModule('user-profiles')

    expect(await read('user-profiles', 'schemas/user-profile.schema.ts')).toContain(
      'export class UserProfileSchema {}',
    )
    expect(await read('user-profiles', 'rules/create.ts')).toContain('CreateUserProfileRule')
  })
})

// ---------------------------------------------------------------------------
// File contents
// ---------------------------------------------------------------------------

describe('restGenerateModule: controller', () => {
  test('without a service: empty constructor and no service references', async () => {
    await restGenerateModule('users')
    const controller = await read('users', 'users.controller.ts')

    expect(controller).toContain("import type { ContextHandler } from 'ventjs'")
    expect(controller).toContain('export class UsersController')
    expect(controller).toContain('constructor() {}')
    expect(controller).not.toContain('Service')
  })

  test('with a service: imports it and calls it from every handler', async () => {
    await restGenerateModule('users', true)
    const controller = await read('users', 'users.controller.ts')

    expect(controller).toContain("import { UsersService } from './users.service'")
    expect(controller).toContain('constructor(private readonly usersService: UsersService) {}')

    for (const method of ['create', 'findAll', 'findOne', 'update', 'delete']) {
      expect(controller).toContain(`const result = await this.usersService.${method}()`)
    }
  })

  test('exposes the five handlers and verifyToken', async () => {
    await restGenerateModule('users')
    const controller = await read('users', 'users.controller.ts')

    for (const method of ['create', 'findAll', 'findOne', 'update', 'delete']) {
      expect(controller).toContain(`readonly ${method}: ContextHandler = async (ctx, reply) => {`)
    }

    expect(controller).toContain('verifyToken(token: string)')
  })
})

describe('restGenerateModule: service', () => {
  test('exposes the five CRUD methods', async () => {
    await restGenerateModule('users', true)
    const service = await read('users', 'users.service.ts')

    expect(service).toContain('export class UsersService')

    for (const method of ['create', 'findAll', 'findOne', 'update', 'delete']) {
      expect(service).toContain(`async ${method}() {`)
    }
  })

  test('is not generated without withService', async () => {
    await restGenerateModule('users')

    expect(await exists(path.join(moduleDir('users'), 'users.service.ts'))).toBe(false)
    expect(await exists(path.join(moduleDir('users'), 'tests/users.service.test.ts'))).toBe(false)
  })
})

describe('restGenerateModule: route', () => {
  test('registers public and protected routes under /api/<module>', async () => {
    await restGenerateModule('users')
    const route = await read('users', 'users.route.ts')

    expect(route).toContain('export class UsersRouter')
    expect(route).toContain("this.app.group('/api/users', (guest) => {")

    expect(route).toContain("guest.GET('/', this.controller.findAll)")
    expect(route).toContain("guest.GET('/:id', this.controller.findOne)")

    expect(route).toContain("auth.POST('/', this.controller.create)")
    expect(route).toContain("auth.PUT('/:id', this.controller.update)")
    expect(route).toContain("auth.DELETE('/:id', this.controller.delete)")
    expect(route).toContain('this.authMiddleware.middleware')
  })

  test('uses the kebab-case module name in the URL', async () => {
    await restGenerateModule('userProfiles')

    expect(await read('user-profiles', 'user-profiles.route.ts')).toContain(
      "this.app.group('/api/user-profiles'",
    )
  })
})

describe('restGenerateModule: module', () => {
  test('without a service: no providers, controller registered directly', async () => {
    await restGenerateModule('users')
    const module = await read('users', 'users.module.ts')

    expect(module).toContain('export class UsersModule extends DIModule')
    expect(module).toContain('override controllers = [UsersController]')
    expect(module).toContain(
      'override routers = [bind(UsersRouter, Vent, UsersController, AuthMiddleware)]',
    )
    expect(module).toContain("defineAuth({ verifier: UsersController, mode: 'bearer' })")
    expect(module).not.toContain('providers')
    expect(module).not.toContain('Service')
  })

  test('with a service: registers it as a provider and binds it to the controller', async () => {
    await restGenerateModule('users', true)
    const module = await read('users', 'users.module.ts')

    expect(module).toContain("import { UsersService } from './users.service'")
    expect(module).toContain('override providers = [UsersService]')
    expect(module).toContain('override controllers = [bind(UsersController, UsersService)]')
  })
})

describe('restGenerateModule: rules and schema', () => {
  test('create rule is an empty defineSchema and update reuses it', async () => {
    await restGenerateModule('users')

    const create = await read('users', 'rules/create.ts')
    const update = await read('users', 'rules/update.ts')

    expect(create).toContain("import { defineSchema, Validator } from 'ventjs'")
    expect(create).toContain('export const CreateUserRule = defineSchema({})')

    expect(update).toContain("import { CreateUserRule } from './create'")
    expect(update).toContain('export const UpdateUserRule = CreateUserRule')
  })
})

describe('restGenerateModule: generated tests', () => {
  test('controller test without a service', async () => {
    await restGenerateModule('users')
    const test_ = await read('users', 'tests/users.controller.test.ts')

    expect(test_).toContain("import { describe, expect, test } from 'bun:test'")
    expect(test_).toContain("import { UsersController } from '../users.controller'")
    expect(test_).toContain("describe('UsersController'")
    expect(test_).toContain('const usersController = new UsersController()')
    expect(test_).not.toContain('Service')
  })

  test('controller test with a service', async () => {
    await restGenerateModule('users', true)
    const test_ = await read('users', 'tests/users.controller.test.ts')

    expect(test_).toContain("import { UsersService } from '../users.service'")
    expect(test_).toContain('new UsersController(new UsersService())')
  })

  test('service test checks every method', async () => {
    await restGenerateModule('users', true)
    const test_ = await read('users', 'tests/users.service.test.ts')

    expect(test_).toContain("describe('UsersService'")

    for (const method of ['create', 'findAll', 'findOne', 'update', 'delete']) {
      expect(test_).toContain(`expect(typeof usersService.${method}).toBe('function')`)
    }
  })
})

// ---------------------------------------------------------------------------
// Existing files and rollback
// ---------------------------------------------------------------------------

describe('restGenerateModule: existing files', () => {
  test('refuses to overwrite an existing file and creates nothing else', async () => {
    const existing = path.join(moduleDir('users'), 'users.controller.ts')
    await mkdir(path.dirname(existing), { recursive: true })
    await writeFile(existing, '// my code')

    await expect(restGenerateModule('users')).rejects.toThrow(
      `File "${path.join('src', 'modules', 'users', 'users.controller.ts')}" already exists.`,
    )

    expect(await readFile(existing, 'utf8')).toBe('// my code')
    expect(await listFiles(moduleDir('users'))).toEqual(['users.controller.ts'])
  })

  test('checks nested files too, before writing anything', async () => {
    const existing = path.join(moduleDir('users'), 'rules', 'create.ts')
    await mkdir(path.dirname(existing), { recursive: true })
    await writeFile(existing, '// mine')

    await expect(restGenerateModule('users')).rejects.toThrow('already exists')

    // files that come earlier in the list were not created either
    expect(await listFiles(moduleDir('users'))).toEqual(['rules/create.ts'])
    expect(await readFile(existing, 'utf8')).toBe('// mine')
  })

  test('a second run for the same module fails and leaves the first result intact', async () => {
    await restGenerateModule('users')
    const before = await listFiles(moduleDir('users'))

    await expect(restGenerateModule('users')).rejects.toThrow('already exists')

    expect(await listFiles(moduleDir('users'))).toEqual(before)
  })

  test('with and without a service do not conflict on different modules', async () => {
    await restGenerateModule('users')
    await expect(restGenerateModule('orders', true)).resolves.toBeUndefined()
  })
})

describe('restGenerateModule: rollback', () => {
  test('removes the files it already wrote when a later write fails', async () => {
    // A regular file named "rules" makes `mkdir(.../rules)` fail after the first
    // files have been written.
    await mkdir(moduleDir('users'), { recursive: true })
    await writeFile(path.join(moduleDir('users'), 'rules'), 'blocker')

    await expect(restGenerateModule('users')).rejects.toThrow()

    expect(await listFiles(moduleDir('users'))).toEqual(['rules'])
    expect(await exists(path.join(moduleDir('users'), 'users.controller.ts'))).toBe(false)
    expect(await exists(path.join(moduleDir('users'), 'users.module.ts'))).toBe(false)
  })

  test('prints no success message when generation fails', async () => {
    await mkdir(moduleDir('users'), { recursive: true })
    await writeFile(path.join(moduleDir('users'), 'rules'), 'blocker')

    await expect(restGenerateModule('users')).rejects.toThrow()

    expect(output()).not.toContain('generated')
  })
})

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

describe('restGenerateModule: console output', () => {
  test('prints a summary with the module name and directory', async () => {
    await restGenerateModule('users')

    expect(output()).toContain('✓ VentJS · users generated')
    expect(output()).toContain(`📁 ${path.join('src', 'modules', 'users')}`)
  })

  test('lists every file as a tree, closing with └──', async () => {
    await restGenerateModule('users')

    const lines = output()
      .split('\n')
      .filter((line) => line.includes('├──') || line.includes('└──'))

    expect(lines).toHaveLength(BASE_FILES.length)

    for (const file of BASE_FILES.slice(0, -1)) {
      expect(output()).toContain(`├── ${file}`)
    }

    expect(lines.filter((line) => line.includes('└──'))).toHaveLength(1)
    expect(lines.at(-1)).toContain(`└── ${BASE_FILES.at(-1)}`)
  })

  test('with a service the last file in the tree is the service test', async () => {
    await restGenerateModule('users', true)

    const lines = output()
      .split('\n')
      .filter((line) => line.includes('├──') || line.includes('└──'))

    expect(lines).toHaveLength(BASE_FILES.length + 2)
    expect(lines.at(-1)).toContain('└── tests/users.service.test.ts')
    expect(output()).toContain('├── users.service.ts')
  })
})
