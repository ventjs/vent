import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

// Naming helpers. They follow the same rules as the REST module generator so a
// module gets the same file and class names whichever template the project uses.

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

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value)

  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

function toWords(kebabValue: string): string {
  return kebabValue.replace(/-/g, ' ')
}

// "a post", "an order", "a user"
function withArticle(words: string): string {
  return /^[aeio]/i.test(words) ? `an ${words}` : `a ${words}`
}

function isValidModuleName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
}

export async function generateGraphqlModule(name: string): Promise<void> {
  if (!isValidModuleName(name)) {
    throw new Error(
      'Invalid module name. Use letters, numbers, "-" or "_", starting with a letter.',
    )
  }

  const moduleName = toKebabCase(name)
  const singularName = toSingular(moduleName)

  // The schema needs two different root fields: the list (`posts`) and the single item (`post`).
  if (singularName === moduleName) {
    throw new Error(
      `Cannot derive different singular and plural names from "${name}". Use the plural form, for example "${moduleName}s".`,
    )
  }

  const className = toPascalCase(moduleName)
  const typeName = toPascalCase(singularName)

  const pluralField = toCamelCase(moduleName)
  const singularField = toCamelCase(singularName)
  const serviceName = pluralField

  const pluralWords = toWords(moduleName)
  const singularWords = withArticle(toWords(singularName))

  const directory = path.resolve(process.cwd(), 'src', 'modules', moduleName)

  const files: Record<string, string> = {
    [`graphql-schema/${moduleName}.graphql`]: `type ${typeName} {
  id: ID!
}

input Create${typeName}Input {
}

input Update${typeName}Input {
}

type Query {
  ${pluralField}: [${typeName}!]!
  ${singularField}(id: ID!): ${typeName}
}

type Mutation {
  create${typeName}(input: Create${typeName}Input!): ${typeName}!
  update${typeName}(id: ID!, input: Update${typeName}Input!): ${typeName}
  delete${typeName}(id: ID!): ${typeName}
}
`,

    [`tests/${moduleName}.service.test.ts`]: '',

    [`tests/${moduleName}.resolver.test.ts`]: '',

    [`${moduleName}.module.ts`]: `import { bind, DIModule } from 'ventjs'
import { ${className}Service } from './${moduleName}.service'
import { ${className}Resolver } from './${moduleName}.resolver'

export class ${className}Module extends DIModule {
  override imports = []
  override providers = [${className}Service, bind(${className}Resolver, ${className}Service)]
}
`,

    [`${moduleName}.service.ts`]: `export interface Create${typeName}Input {}

export interface Update${typeName}Input {}

export class ${className}Service {
  async create(input: Create${typeName}Input) {
    // Implement ${pluralWords} creation
  }

  async findAll() {
    // Implement fetching all ${pluralWords}
  }

  async findOne(id: string) {
    // Implement fetching ${singularWords} by ID
  }

  async update(id: string, input: Update${typeName}Input) {
    // Implement updating ${singularWords}
  }

  async delete(id: string) {
    // Implement deleting ${singularWords}
  }
}
`,

    [`${moduleName}.resolver.ts`]: `import type {Create${typeName}Input,${className}Service,Update${typeName}Input} from './${moduleName}.service'

interface ${typeName}Args {
  id: string
}

interface Create${typeName}Args {
  input: Create${typeName}Input
}

interface Update${typeName}Args {
  id: string
  input: Update${typeName}Input
}

export class ${className}Resolver {
  constructor(private readonly ${serviceName}Service: ${className}Service) {}

  // Queries

  readonly ${pluralField} = async () => {
    return this.${serviceName}Service.findAll()
  }

  readonly ${singularField} = async (args: ${typeName}Args) => {
    return this.${serviceName}Service.findOne(args.id)
  }

  // Mutations

  readonly create${typeName} = async (args: Create${typeName}Args) => {
    return this.${serviceName}Service.create(args.input)
  }

  readonly update${typeName} = async (args: Update${typeName}Args) => {
    return this.${serviceName}Service.update(args.id, args.input)
  }

  readonly delete${typeName} = async (args: ${typeName}Args) => {
    return this.${serviceName}Service.delete(args.id)
  }
}
`,
  }

  // Check every target before creating anything.
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

  const filePaths = Object.keys(files)

  for (const [index, relativePath] of filePaths.entries()) {
    const prefix = index === filePaths.length - 1 ? '└──' : '├──'
    console.log(`     ${prefix} ${relativePath}`)
  }

  console.log('')
}
