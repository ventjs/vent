
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detectProjectType } from '../../../../cli/utils/project-type'


describe('detectProjectType()', () => {
  let tempDirs: string[] = []

  async function createProject(packageJson?: unknown): Promise<string> {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ventjs-project-'))
    tempDirs.push(cwd)

    if (packageJson !== undefined) {
      await writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify(packageJson),
        'utf8',
      )
    }

    return cwd
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )

    tempDirs = []
  })

  test('detects GraphQL projects from the ventAPI marker', async () => {
    const cwd = await createProject({
      name: 'my-graphql-app',
      ventAPI: {
        template: 'graphql',
      },
    })

    expect(await detectProjectType(cwd)).toBe('graphql')
  })

  test('detects REST projects explicitly', async () => {
    const cwd = await createProject({
      name: 'my-rest-app',
      ventAPI: {
        template: 'rest',
      },
    })

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when the ventAPI marker is missing', async () => {
    const cwd = await createProject({
      name: 'my-app',
    })

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when the template is not GraphQL', async () => {
    const cwd = await createProject({
      ventAPI: {
        template: 'unknown',
      },
    })

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when package.json does not exist', async () => {
    const cwd = await createProject()

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when package.json contains invalid JSON', async () => {
    const cwd = await createProject()

    await writeFile(
      path.join(cwd, 'package.json'),
      '{ invalid json',
      'utf8',
    )

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when package.json is null', async () => {
    const cwd = await createProject(null)

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when ventAPI is null', async () => {
    const cwd = await createProject({
      ventAPI: null,
    })

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('defaults to REST when ventAPI is not an object', async () => {
    const cwd = await createProject({
      ventAPI: 'graphql',
    })

    expect(await detectProjectType(cwd)).toBe('rest')
  })

  test('uses the provided working directory', async () => {
    const cwd = await createProject({
      ventAPI: {
        template: 'graphql',
      },
    })

    expect(await detectProjectType(cwd)).toBe('graphql')
  })
})
