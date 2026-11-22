import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ProjectType = 'rest' | 'graphql'

interface VentPackageJson {
  ventAPI?: {
    template?: unknown
  }
}

/**
 * Detects which template the current project was created from.
 *
 * `create-ventjs` ships the GraphQL template with a `ventAPI.template`
 * marker inside its package.json:
 *
 *   "ventAPI": { "template": "graphql" }
 *
 * Any project without that marker (every REST project, including the ones
 * created before the marker existed) is treated as REST, so the existing
 * behavior never changes. A missing or unreadable package.json also means REST.
 */
export async function detectProjectType(cwd: string = process.cwd()): Promise<ProjectType> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf8')
    const packageJson = JSON.parse(raw) as VentPackageJson | null

    return packageJson?.ventAPI?.template === 'graphql' ? 'graphql' : 'rest'
  } catch {
    return 'rest'
  }
}
