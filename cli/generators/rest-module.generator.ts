import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

function toPascalCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
}

function toSingular(value: string): string {
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`
  }

  if (value.endsWith('s') && !value.endsWith('ss')) {
    return value.slice(0, -1)
  }

  return value
}

function isValidModuleName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
}

export async function restGenerateModule(name: string, withService = false): Promise<void> {
  if (!isValidModuleName(name)) {
    throw new Error(
      'Invalid module name. Use letters, numbers, "-" or "_", starting with a letter.',
    )
  }

  const moduleName = toKebabCase(name)
  const className = toPascalCase(moduleName)
  const singularName = toSingular(moduleName)
  const singularClassName = toPascalCase(singularName)

  const directory = path.resolve(process.cwd(), 'src', 'modules', moduleName)
  const serviceName = className.charAt(0).toLowerCase() + className.slice(1)
  const controllerName = className.charAt(0).toLowerCase() + className.slice(1)

  const serviceTemplate = `export class ${className}Service {
	constructor() {}
  async create() {
    // TODO: Implement creation logic.
  }

  async findAll() {
    // TODO: Implement fetching all records.
  }

  async findOne() {
    // TODO: Implement fetching a record by ID.
  }

  async update() {
    // TODO: Implement updating a record.
  }

  async delete() {
    // TODO: Implement deleting a record.
  }
}
`

  const files: Record<string, string> = {
    ...(withService
      ? {
          [`${moduleName}.service.ts`]: serviceTemplate,
        }
      : {}),

    [`${moduleName}.controller.ts`]: `import type { ContextHandler } from 'ventjs'
${withService ? `import { ${className}Service } from './${moduleName}.service'` : ''}

export class ${className}Controller {
  ${
    withService
      ? `constructor(private readonly ${serviceName}Service: ${className}Service) {}`
      : 'constructor() {}'
  }

  readonly create: ContextHandler = async (ctx, reply) => {
    // TODO: Implement creation logic.
    ${withService ? `const result = await this.${serviceName}Service.create()` : ''}
  }

  readonly findAll: ContextHandler = async (ctx, reply) => {
    // TODO: Implement fetching all records.
    ${withService ? `const result = await this.${serviceName}Service.findAll()` : ''}
  }

  readonly findOne: ContextHandler = async (ctx, reply) => {
    // TODO: Implement fetching a record by ID.
    ${withService ? `const result = await this.${serviceName}Service.findOne()` : ''}
  }

  readonly update: ContextHandler = async (ctx, reply) => {
    // TODO: Implement updating a record.
    ${withService ? `const result = await this.${serviceName}Service.update()` : ''}
  }

  readonly delete: ContextHandler = async (ctx, reply) => {
    // TODO: Implement deleting a record.
    ${withService ? `const result = await this.${serviceName}Service.delete()` : ''}
  }

  verifyToken(token: string) {
    // TODO: Implement token verification.
    return null
  }
}
`,

    [`${moduleName}.route.ts`]: `import type { Vent } from 'ventjs'
import { AuthMiddleware } from 'ventjs'
import { ${className}Controller } from './${moduleName}.controller'

export class ${className}Router {
  constructor(
    private readonly app: Vent,
    private readonly controller: ${className}Controller,
    private readonly authMiddleware: AuthMiddleware,
  ) {}

  register(): void {
    this.app.group('/api/${moduleName}', (guest) => {
      // Public routes
      guest.GET('/', this.controller.findAll)
      guest.GET('/:id', this.controller.findOne)

      // Protected routes
      guest.group(
        '/',
        (auth) => {
          auth.POST('/', this.controller.create)
          auth.PUT('/:id', this.controller.update)
          auth.DELETE('/:id', this.controller.delete)
        },
        this.authMiddleware.middleware,
      )
    })
  }
}
`,

    [`${moduleName}.module.ts`]: `import { defineAuth, Vent, AuthMiddleware, bind, DIModule } from 'ventjs'
import { ${className}Controller } from './${moduleName}.controller'
import { ${className}Router } from './${moduleName}.route'
${withService ? `import { ${className}Service } from './${moduleName}.service'` : ''}

export class ${className}Module extends DIModule {
  override imports = []
  ${withService ? `override providers = [${className}Service]` : ''}
  override controllers = [${withService ? `bind(${className}Controller, ${className}Service)` : `${className}Controller`}]
  override routers = [bind(${className}Router, Vent, ${className}Controller, AuthMiddleware)]
  override auth = defineAuth({ verifier: ${className}Controller, mode: 'bearer' })
}
`,

    [`schemas/${singularName}.schema.ts`]: `// You can use const instead of class if your project requires it.
export class ${singularClassName}Schema {}
`,
    ['rules/create.ts']: `import { defineSchema, Validator } from 'ventjs'
  
export const Create${singularClassName}Rule = defineSchema({})
`,

    ['rules/update.ts']: `import { Create${singularClassName}Rule } from './create'

export const Update${singularClassName}Rule = Create${singularClassName}Rule
`,

    [`tests/${moduleName}.controller.test.ts`]: `import { describe, expect, test } from 'bun:test'
import { ${className}Controller } from '../${moduleName}.controller'
${withService ? `import { ${className}Service } from '../${moduleName}.service'` : ''}

describe('${className}Controller', () => {
  const ${controllerName}Controller = new ${className}Controller(${withService ? `new ${className}Service()` : ''})

  test('should be defined', () => {
    expect(${controllerName}Controller).toBeDefined()
  })

  test('should expose all route handlers', () => {
    expect(typeof ${controllerName}Controller.create).toBe('function')
    expect(typeof ${controllerName}Controller.findAll).toBe('function')
    expect(typeof ${controllerName}Controller.findOne).toBe('function')
    expect(typeof ${controllerName}Controller.update).toBe('function')
    expect(typeof ${controllerName}Controller.delete).toBe('function')
  })
})
`,
    ...(withService
      ? {
          [`tests/${moduleName}.service.test.ts`]: `import { describe, expect, test } from 'bun:test'
import { ${className}Service } from '../${moduleName}.service'

describe('${className}Service', () => {
  const ${serviceName}Service = new ${className}Service()

  test('should be defined', () => {
    expect(${serviceName}Service).toBeDefined()
  })

  test('should expose all service methods', () => {
    expect(typeof ${serviceName}Service.create).toBe('function')
    expect(typeof ${serviceName}Service.findAll).toBe('function')
    expect(typeof ${serviceName}Service.findOne).toBe('function')
    expect(typeof ${serviceName}Service.update).toBe('function')
    expect(typeof ${serviceName}Service.delete).toBe('function')
  })
})
`,
        }
      : {}),
  }

  await mkdir(directory, { recursive: true })

  // Check every target before creating files.
  for (const relativePath of Object.keys(files)) {
    const filePath = path.join(directory, relativePath)

    if (await Bun.file(filePath).exists()) {
      throw new Error(`File "${path.relative(process.cwd(), filePath)}" already exists.`)
    }
  }

  const createdFiles: string[] = []

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(directory, relativePath)

      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, content, { flag: 'wx' })

      createdFiles.push(filePath)
    }
  } catch (error) {
    await Promise.all(createdFiles.map((filePath) => unlink(filePath).catch(() => {})))

    throw error
  }

  console.log('')
  console.log(`  ✓ VentJS · ${moduleName} generated`)
  console.log(`  📁 ${path.relative(process.cwd(), directory)}`)

  for (const [index, file] of Object.keys(files).entries()) {
    const prefix = index === Object.keys(files).length - 1 ? '  └──' : '  ├──'
    console.log(`${prefix} ${file}`)
  }

  console.log('')
}
