import { existsSync } from 'node:fs'
import path from 'node:path'

export function toPosix(p: string): string {
  return p.replaceAll('\\', '/')
}

function findProjectRoot(from: string): string {
  let dir = from

  for (;;) {
    if (existsSync(path.join(dir, 'tsconfig.json'))) return dir

    const parent = path.dirname(dir)

    if (parent === dir) {
      throw new Error(`No tsconfig.json found in or above ${from}`)
    }

    dir = parent
  }
}

/** The tests folder (the parent of support). */
export const testsDir = toPosix(path.resolve(import.meta.dir, '..'))

/** Nearest folder above the tests that holds a tsconfig.json. */
export const projectRoot = toPosix(findProjectRoot(testsDir))

/** The public entry point of the validation package. */
export const ENTRY_FILE = toPosix(
  path.resolve(testsDir, '../../../src/index.ts'),
)

if (!existsSync(ENTRY_FILE)) {
  throw new Error(
    `ENTRY_FILE does not exist: ${ENTRY_FILE} (adjust it in tests/support/project.ts)`,
  )
}

/** Import specifier for ENTRY_FILE as seen from fromDir. */
export function specifierFrom(fromDir: string, file: string = ENTRY_FILE): string {
  const relative = toPosix(path.relative(fromDir, file)).replace(/\.ts$/, '')

  return relative.startsWith('.') ? relative : `./${relative}`
}
