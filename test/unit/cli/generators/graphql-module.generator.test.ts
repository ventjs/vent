import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateGraphqlModule } from '../../../../cli/generators/graphql-module.generator'

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
  workspace = await mkdtemp(path.join(tmpdir(), 'vent-graphql-generator-'))
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

// Order in which the generator writes (and prints) the files.
const POSTS_FILES = [
  'graphql-schema/posts.graphql',
  'tests/posts.service.test.ts',
  'tests/posts.resolver.test.ts',
  'posts.module.ts',
  'posts.service.ts',
  'posts.resolver.ts',
]

// ---------------------------------------------------------------------------
// Module name validation
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: module name validation', () => {
  const invalidNames = [
    '',
    '1posts',
    '-posts',
    '_posts',
    'blog post',
    'posts!',
    '../escape',
    'posts/admin',
    'posts.v2',
    'منشورات',
  ]

  for (const name of invalidNames) {
    test(`rejects ${JSON.stringify(name)} and creates nothing`, async () => {
      await expect(generateGraphqlModule(name)).rejects.toThrow('Invalid module name')

      expect(await exists(path.join(process.cwd(), 'src'))).toBe(false)
    })
  }

  for (const name of ['posts', 'blog_posts', 'v2-posts', 'blogPosts']) {
    test(`accepts ${JSON.stringify(name)}`, async () => {
      await expect(generateGraphqlModule(name)).resolves.toBeUndefined()
    })
  }
})

test('rejects a valid-looking name that ends with a digit (no singular form)', async () => {
  await expect(generateGraphqlModule('Posts-2')).rejects.toThrow(
    'Cannot derive different singular and plural names from "Posts-2"',
  )
})

describe('generateGraphqlModule: singular and plural names', () => {
  // A GraphQL schema needs two root fields (`posts` and `post`), so the name must change
  // when it is made singular.
  for (const name of ['data', 'address', 'sheep']) {
    test(`rejects "${name}" because its singular form is the same word`, async () => {
      await expect(generateGraphqlModule(name)).rejects.toThrow(
        `Cannot derive different singular and plural names from "${name}"`,
      )

      expect(await exists(path.join(process.cwd(), 'src'))).toBe(false)
    })
  }

  test('suggests the plural form in the error message', async () => {
    await expect(generateGraphqlModule('data')).rejects.toThrow('for example "datas"')
  })
})

// ---------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: generated files', () => {
  test('creates the schema, module, service, resolver and the two test files', async () => {
    await generateGraphqlModule('posts')

    expect(await listFiles(moduleDir('posts'))).toEqual([...POSTS_FILES].sort())
  })

  test('creates src/modules recursively when it does not exist', async () => {
    expect(await exists(path.join(process.cwd(), 'src'))).toBe(false)

    await generateGraphqlModule('posts')

    expect(await exists(moduleDir('posts'))).toBe(true)
  })

  test('every generated .ts file is valid TypeScript', async () => {
    await generateGraphqlModule('blog-posts')

    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const failures: string[] = []

    for (const file of await listFiles(moduleDir('blog-posts'))) {
      if (!file.endsWith('.ts')) continue

      const source = await read('blog-posts', file)

      try {
        transpiler.transformSync(source)
      } catch (error) {
        failures.push(`${file}: ${String(error)}`)
      }
    }

    expect(failures).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: naming', () => {
  const normalized: Array<[input: string, directory: string]> = [
    ['posts', 'posts'],
    ['Posts', 'posts'],
    ['BlogPosts', 'blog-posts'],
    ['blog_posts', 'blog-posts'],
    ['BLOG_POSTS', 'blog-posts'],
    ['blogPosts', 'blog-posts'],
  ]

  for (const [input, directory] of normalized) {
    test(`"${input}" becomes the "${directory}" module`, async () => {
      await generateGraphqlModule(input)

      expect(await exists(path.join(moduleDir(directory), `${directory}.module.ts`))).toBe(true)
      expect(await exists(path.join(moduleDir(directory), `${directory}.resolver.ts`))).toBe(true)
      expect(
        await exists(path.join(moduleDir(directory), 'graphql-schema', `${directory}.graphql`)),
      ).toBe(true)
    })
  }

  test('multi-word names: PascalCase types, camelCase fields', async () => {
    await generateGraphqlModule('blog-posts')

    const schema = await read('blog-posts', 'graphql-schema/blog-posts.graphql')
    const resolver = await read('blog-posts', 'blog-posts.resolver.ts')

    expect(schema).toContain('type BlogPost {')
    expect(schema).toContain('blogPosts: [BlogPost!]!')
    expect(schema).toContain('blogPost(id: ID!): BlogPost')

    expect(resolver).toContain('export class BlogPostsResolver')
    expect(resolver).toContain(
      'constructor(private readonly blogPostsService: BlogPostsService) {}',
    )
    expect(resolver).toContain('readonly blogPosts = async () => {')
    expect(resolver).toContain('readonly blogPost = async (args: BlogPostArgs) => {')
  })

  test('turns "ies" into "y" for the type name', async () => {
    await generateGraphqlModule('categories')

    const schema = await read('categories', 'graphql-schema/categories.graphql')

    expect(schema).toContain('type Category {')
    expect(schema).toContain('categories: [Category!]!')
    expect(schema).toContain('category(id: ID!): Category')
  })
})

// ---------------------------------------------------------------------------
// File contents
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: GraphQL schema', () => {
  test('declares the type, the inputs and the Query / Mutation roots', async () => {
    await generateGraphqlModule('posts')
    const schema = await read('posts', 'graphql-schema/posts.graphql')

    expect(schema).toContain('type Post {\n  id: ID!\n}')
    expect(schema).toContain('input CreatePostInput {')
    expect(schema).toContain('input UpdatePostInput {')

    expect(schema).toContain('type Query {')
    expect(schema).toContain('posts: [Post!]!')
    expect(schema).toContain('post(id: ID!): Post')

    expect(schema).toContain('type Mutation {')
    expect(schema).toContain('createPost(input: CreatePostInput!): Post!')
    expect(schema).toContain('updatePost(id: ID!, input: UpdatePostInput!): Post')
    expect(schema).toContain('deletePost(id: ID!): Post')
  })
})

describe('generateGraphqlModule: service', () => {
  test('declares the inputs and the five CRUD methods', async () => {
    await generateGraphqlModule('posts')
    const service = await read('posts', 'posts.service.ts')

    expect(service).toContain('export interface CreatePostInput {}')
    expect(service).toContain('export interface UpdatePostInput {}')
    expect(service).toContain('export class PostsService')

    expect(service).toContain('async create(input: CreatePostInput) {')
    expect(service).toContain('async findAll() {')
    expect(service).toContain('async findOne(id: string) {')
    expect(service).toContain('async update(id: string, input: UpdatePostInput) {')
    expect(service).toContain('async delete(id: string) {')
  })

  test('comments use the plural words and a/an before the singular', async () => {
    await generateGraphqlModule('posts')
    const service = await read('posts', 'posts.service.ts')

    expect(service).toContain('// Implement posts creation')
    expect(service).toContain('// Implement fetching all posts')
    expect(service).toContain('// Implement fetching a post by ID')
    expect(service).toContain('// Implement updating a post')
    expect(service).toContain('// Implement deleting a post')
  })

  test('uses "an" before a singular that starts with a vowel', async () => {
    await generateGraphqlModule('orders')
    const service = await read('orders', 'orders.service.ts')

    expect(service).toContain('// Implement fetching an order by ID')
    expect(service).toContain('// Implement updating an order')
  })

  test('turns kebab-case into spaced words in comments', async () => {
    await generateGraphqlModule('blog-posts')
    const service = await read('blog-posts', 'blog-posts.service.ts')

    expect(service).toContain('// Implement blog posts creation')
    expect(service).toContain('// Implement fetching a blog post by ID')
  })
})

describe('generateGraphqlModule: resolver', () => {
  test('imports the service and its input types', async () => {
    await generateGraphqlModule('posts')
    const resolver = await read('posts', 'posts.resolver.ts')

    // whitespace-tolerant: only the imported names and the source matter
    expect(resolver).toMatch(
      /import type \{\s*CreatePostInput,\s*PostsService,\s*UpdatePostInput\s*\} from '\.\/posts\.service'/,
    )
  })

  test('declares the argument shapes', async () => {
    await generateGraphqlModule('posts')
    const resolver = await read('posts', 'posts.resolver.ts')

    expect(resolver).toContain('interface PostArgs {')
    expect(resolver).toContain('interface CreatePostArgs {')
    expect(resolver).toContain('input: CreatePostInput')
    expect(resolver).toContain('interface UpdatePostArgs {')
    expect(resolver).toContain('input: UpdatePostInput')
  })

  test('maps every query and mutation to the service', async () => {
    await generateGraphqlModule('posts')
    const resolver = await read('posts', 'posts.resolver.ts')

    expect(resolver).toContain('export class PostsResolver')
    expect(resolver).toContain('constructor(private readonly postsService: PostsService) {}')

    expect(resolver).toContain('readonly posts = async () => {')
    expect(resolver).toContain('return this.postsService.findAll()')

    expect(resolver).toContain('readonly post = async (args: PostArgs) => {')
    expect(resolver).toContain('return this.postsService.findOne(args.id)')

    expect(resolver).toContain('readonly createPost = async (args: CreatePostArgs) => {')
    expect(resolver).toContain('return this.postsService.create(args.input)')

    expect(resolver).toContain('readonly updatePost = async (args: UpdatePostArgs) => {')
    expect(resolver).toContain('return this.postsService.update(args.id, args.input)')

    expect(resolver).toContain('readonly deletePost = async (args: PostArgs) => {')
    expect(resolver).toContain('return this.postsService.delete(args.id)')
  })

  test('resolver names match the Query / Mutation fields of the schema', async () => {
    await generateGraphqlModule('posts')
    const schema = await read('posts', 'graphql-schema/posts.graphql')
    const resolver = await read('posts', 'posts.resolver.ts')

    for (const field of ['posts', 'post', 'createPost', 'updatePost', 'deletePost']) {
      expect(schema).toMatch(new RegExp(`\\b${field}\\b[:(]`))
      expect(resolver).toContain(`readonly ${field} = async`)
    }
  })
})

describe('generateGraphqlModule: module', () => {
  test('registers the service and the resolver bound to it', async () => {
    await generateGraphqlModule('posts')
    const module = await read('posts', 'posts.module.ts')

    expect(module).toContain("import { bind, DIModule } from 'ventjs'")
    expect(module).toContain("import { PostsService } from './posts.service'")
    expect(module).toContain("import { PostsResolver } from './posts.resolver'")
    expect(module).toContain('export class PostsModule extends DIModule')
    expect(module).toContain('override imports = []')
    expect(module).toContain(
      'override providers = [PostsService, bind(PostsResolver, PostsService)]',
    )
  })
})

// ---------------------------------------------------------------------------
// Existing files and rollback
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: existing files', () => {
  test('refuses to overwrite an existing file and creates nothing else', async () => {
    const existing = path.join(moduleDir('posts'), 'posts.service.ts')
    await mkdir(path.dirname(existing), { recursive: true })
    await writeFile(existing, '// my code')

    await expect(generateGraphqlModule('posts')).rejects.toThrow(
      `File "${path.join('src', 'modules', 'posts', 'posts.service.ts')}" already exists.`,
    )

    expect(await readFile(existing, 'utf8')).toBe('// my code')
    expect(await listFiles(moduleDir('posts'))).toEqual(['posts.service.ts'])
  })

  test('checks nested files too, before writing anything', async () => {
    const existing = path.join(moduleDir('posts'), 'tests', 'posts.resolver.test.ts')
    await mkdir(path.dirname(existing), { recursive: true })
    await writeFile(existing, '// mine')

    await expect(generateGraphqlModule('posts')).rejects.toThrow('already exists')

    // the schema comes first in the list and must not have been created
    expect(await listFiles(moduleDir('posts'))).toEqual(['tests/posts.resolver.test.ts'])
    expect(await readFile(existing, 'utf8')).toBe('// mine')
  })

  test('a second run for the same module fails and leaves the first result intact', async () => {
    await generateGraphqlModule('posts')
    const before = await listFiles(moduleDir('posts'))

    await expect(generateGraphqlModule('posts')).rejects.toThrow('already exists')

    expect(await listFiles(moduleDir('posts'))).toEqual(before)
  })

  test('different modules do not conflict', async () => {
    await generateGraphqlModule('posts')

    await expect(generateGraphqlModule('comments')).resolves.toBeUndefined()
  })
})

describe('generateGraphqlModule: rollback', () => {
  test('removes the files it already wrote when a later write fails', async () => {
    // A regular file named "tests" makes `mkdir(.../tests)` fail after the schema was written.
    await mkdir(moduleDir('posts'), { recursive: true })
    await writeFile(path.join(moduleDir('posts'), 'tests'), 'blocker')

    await expect(generateGraphqlModule('posts')).rejects.toThrow()

    expect(await exists(path.join(moduleDir('posts'), 'graphql-schema/posts.graphql'))).toBe(false)
    expect(await exists(path.join(moduleDir('posts'), 'posts.module.ts'))).toBe(false)
    expect(await exists(path.join(moduleDir('posts'), 'posts.service.ts'))).toBe(false)
    expect(await exists(path.join(moduleDir('posts'), 'posts.resolver.ts'))).toBe(false)
  })

  test('prints no success message when generation fails', async () => {
    await mkdir(moduleDir('posts'), { recursive: true })
    await writeFile(path.join(moduleDir('posts'), 'tests'), 'blocker')

    await expect(generateGraphqlModule('posts')).rejects.toThrow()

    expect(output()).not.toContain('generated')
  })
})

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

describe('generateGraphqlModule: console output', () => {
  test('prints a summary with the module name and directory', async () => {
    await generateGraphqlModule('posts')

    expect(output()).toContain('✓ VentJS · posts generated')
    expect(output()).toContain(`📁 ${path.join('src', 'modules', 'posts')}`)
  })

  test('lists every file as a tree, closing with └──', async () => {
    await generateGraphqlModule('posts')

    const lines = output()
      .split('\n')
      .filter((line) => line.includes('├──') || line.includes('└──'))

    expect(lines).toHaveLength(POSTS_FILES.length)

    for (const file of POSTS_FILES.slice(0, -1)) {
      expect(output()).toContain(`├── ${file}`)
    }

    expect(lines.filter((line) => line.includes('└──'))).toHaveLength(1)
    expect(lines.at(-1)).toContain('└── posts.resolver.ts')
  })

  test('prints nothing when the name is invalid', async () => {
    await expect(generateGraphqlModule('1posts')).rejects.toThrow()

    expect(logSpy.mock.calls).toHaveLength(0)
  })
})
