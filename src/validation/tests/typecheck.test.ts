// Runs the real TypeScript compiler from inside `bun test`, so the compile-time guarantees
// are part of the normal test run:
//   1. the whole project (including tests/types.test.ts, full of @ts-expect-error probes) compiles
//   2. a deliberately wrong program is REJECTED, line by line (negative control)
//
// The compiler is used through its API (no child process, no `node_modules/.bin/tsc`), so the
// result does not depend on the operating system, on where `node_modules` lives (hoisted in
// a monorepo or not), or on how the package is laid out.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { ENTRY_FILE, projectRoot, toPosix } from './support/project'

/** One line per diagnostic, in the same shape tsc prints: `file(line,col): error TS1234: message`. */
function format(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')

    if (d.file === undefined || d.start === undefined) return `error TS${d.code}: ${message}`

    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start)
    const file = path.basename(d.file.fileName)

    return `${file}(${line + 1},${character + 1}): error TS${d.code}: ${message}`
  })
}

function typecheckProject(): string[] {
  const configPath = path.join(projectRoot, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error !== undefined) return format([config.error])

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot)
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })

  return format([...parsed.errors, ...ts.getPreEmitDiagnostics(program)])
}

function typecheckFile(file: string): string[] {
  const program = ts.createProgram({
    rootNames: [file],
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
  })

  return format(ts.getPreEmitDiagnostics(program))
}

describe('TypeScript compilation', () => {
  test('the project typechecks with zero errors', () => {
    expect(typecheckProject()).toEqual([])
  }, 60_000)

  // Every line below must be rejected by the compiler. The expected-error check is per line,
  // so a case that stops being rejected (a regression in the types) fails this test by name.
  const mustBeRejected = [
    // rules that do not exist for a kind
    'Validator.boolean().minLength(1)',
    'Validator.number().email()',
    'Validator.array().min(1)',
    'Validator.date().min(1)',
    'Validator.date().minLength(1)',
    'Validator.date().email()',
    "Validator.object({ a: Validator.text().required() }).minLength(1)",
    // trim() / lowercase() exist on string and text only
    'Validator.number(18, 100).trim()',
    'Validator.number().lowercase()',
    'Validator.boolean().trim()',
    'Validator.boolean().lowercase()',
    'Validator.array(1, 10).trim()',
    'Validator.array().lowercase()',
    "Validator.enum(['admin', 'user']).trim()",
    "Validator.enum(['admin', 'user']).lowercase()",
    "Validator.object({ a: Validator.text().required() }).trim()",
    "Validator.object({ a: Validator.text().required() }).lowercase()",
    'Validator.date().trim()',
    'Validator.date().lowercase()',
    // a rule is applied once; required / nullable and email / url exclude each other
    'Validator.text().trim().trim()',
    'Validator.text().lowercase().lowercase()',
    'Validator.string(3, 50).minLength(5)',
    'Validator.text().email().url()',
    'Validator.text().required().nullable()',
    'Validator.date().required().nullable()',
    // factories
    'Validator.string()',
    'Validator.object()',
    "Validator.object('city')",
    "Validator.object({ city: 'text' })",
    // nested fields follow the same rules as top-level ones
    'Validator.object({ city: Validator.string(2, 100) })',
    'Validator.object({ city: Validator.string(2, 100).required().confirmed() })',
    'Validator.object({ nick: Validator.text().required().email() })',
    "Validator.object({ inner: Validator.object({ city: Validator.text() }).required() })",
  ]

  test('incompatible rules are rejected by the compiler', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ventjs-neg-'))

    try {
      const source = [
        `import { Validator, defineSchema } from '${toPosix(ENTRY_FILE).replace(/\.ts$/, '')}'`,
        '',
        ...mustBeRejected,
        '',
        'defineSchema({',
        '  username: Validator.string(3, 30).required().confirmed(),',
        '  nick: Validator.text().required().email(),',
        '  title: Validator.string(1, 10),',
        '})',
        '',
      ].join('\n')

      const file = path.join(dir, 'bad.ts')
      writeFileSync(file, source)

      const errors = typecheckFile(file)
      expect(errors.length).toBeGreaterThan(0)

      const firstCaseLine = 3 // 1: import, 2: blank, 3: first case
      const rejected = new Set(
        errors.map((e) => /^bad\.ts\((\d+),/.exec(e)?.[1]).filter((n) => n !== undefined).map(Number),
      )

      const accepted = mustBeRejected.filter((_, i) => !rejected.has(firstCaseLine + i))
      expect(accepted).toEqual([])

      // schema-level messages mention the rule that was broken
      // (tsc escapes the quotes inside literal types, so match the parts without quotes)
      const output = errors.join('\n')
      expect(output).toContain('.confirmed() is only allowed on the')
      expect(output).toContain('.email() is only allowed on a field whose name contains')
      expect(output).toContain('call .required() or .nullable() before using it in a schema')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  // The negative control above would also "pass" if the import could not be resolved and
  // everything were an error. This proves the control compiles when the code is right.
  test('the negative control program compiles when written correctly', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ventjs-pos-'))

    try {
      const file = path.join(dir, 'good.ts')
      writeFileSync(
        file,
        [
          `import { Validator, defineSchema } from '${toPosix(ENTRY_FILE).replace(/\.ts$/, '')}'`,
          'export const S = defineSchema({',
          '  email: Validator.text().required().email().trim().lowercase(),',
          '  name: Validator.string(3, 50).trim().required(),',
          '  startDate: Validator.date().required(),',
          '  endDate: Validator.date().nullable(),',
          '  address: Validator.object({ city: Validator.string(2, 100).required() }).required(),',
          '})',
          '',
        ].join('\n'),
      )

      expect(typecheckFile(file)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
