// Asks the real TypeScript language service what it would SUGGEST after a dot.
// This proves incompatible methods are absent from IntelliSense, not just rejected.
//
// The code being completed lives in a virtual file (it is never written to disk). Two details
// make that reliable:
//   - every path handed to / received from the service is forward-slash ("C:/x/y"); on Windows
//     a backslash path never equals the one TypeScript passes back, and the file "disappears"
//   - the file version is a counter, not the text length: two different expressions of the same
//     length would otherwise be served from the service's cache

import { beforeAll, describe, expect, test } from 'bun:test'
import ts from 'typescript'
import { ENTRY_FILE, projectRoot, specifierFrom, testsDir, toPosix } from './support/project'

const probeFile = `${testsDir}/__intellisense_probe__.ts`
const entrySpecifier = specifierFrom(testsDir, ENTRY_FILE)

let service: ts.LanguageService
let source = ''
let version = 0

function completionsAfter(expression: string): string[] {
  const code = `import { Validator } from '${entrySpecifier}'\nconst x = ${expression}.`
  source = code
  version += 1

  const entries = service.getCompletionsAtPosition(probeFile, code.length, {})?.entries ?? []

  return entries
    .filter(
      (e) =>
        e.kind === ts.ScriptElementKind.memberFunctionElement ||
        e.kind === ts.ScriptElementKind.memberVariableElement,
    )
    .map((e) => e.name)
    .sort()
}

beforeAll(() => {
  const configPath = `${projectRoot}/tsconfig.json`
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot)

  const isProbe = (f: string) => toPosix(f) === probeFile

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => [...parsed.fileNames.map(toPosix), probeFile],
    getScriptVersion: (f) => (isProbe(f) ? String(version) : '1'),
    getScriptSnapshot: (f) => {
      if (isProbe(f)) return ts.ScriptSnapshot.fromString(source)

      const text = ts.sys.readFile(f)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (f) => isProbe(f) || ts.sys.fileExists(f),
    readFile: (f) => (isProbe(f) ? source : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  service = ts.createLanguageService(host, ts.createDocumentRegistry())
})

describe('the harness itself', () => {
  // Without this, "expected an empty list" assertions would also pass when the probe file
  // could not be found at all.
  test('sees the probe file and returns real suggestions', () => {
    expect(completionsAfter('Validator.text()').length).toBeGreaterThan(0)
  })

  test('is not fooled by two expressions of the same length', () => {
    const a = completionsAfter('Validator.text()')
    const b = completionsAfter('Validator.date()') // same length as the line above
    expect(a).not.toEqual(b)
  })
})

describe('IntelliSense after `.`', () => {
  test('boolean(): only presence methods', () => {
    expect(completionsAfter('Validator.boolean()')).toEqual(['nullable', 'required'])
  })

  test('number(): presence + min / max', () => {
    expect(completionsAfter('Validator.number()')).toEqual(['max', 'min', 'nullable', 'required'])
  })

  test('array(): presence + minItems / maxItems', () => {
    expect(completionsAfter('Validator.array()')).toEqual([
      'maxItems',
      'minItems',
      'nullable',
      'required',
    ])
  })

  test('enum(): only presence methods', () => {
    expect(completionsAfter("Validator.enum(['a', 'b'])")).toEqual(['nullable', 'required'])
  })

  test('date(): only presence methods', () => {
    expect(completionsAfter('Validator.date()')).toEqual(['nullable', 'required'])
  })

  test('object(): only presence methods', () => {
    expect(
      completionsAfter('Validator.object({ city: Validator.text().required() })'),
    ).toEqual(['nullable', 'required'])
  })

  test('text(): text rules, transformations and presence, nothing numeric', () => {
    expect(completionsAfter('Validator.text()')).toEqual([
      'confirmed',
      'email',
      'lowercase',
      'maxLength',
      'minLength',
      'nullable',
      'required',
      'trim',
      'url',
    ])
  })

  test('string(3, 50): length rules are already used, so they disappear', () => {
    expect(completionsAfter('Validator.string(3, 50)')).toEqual([
      'confirmed',
      'email',
      'lowercase',
      'nullable',
      'required',
      'trim',
      'url',
    ])
  })

  test('trim() and lowercase() are suggested on text kinds only', () => {
    const textual = ['Validator.text()', 'Validator.string(3, 50)']
    const others = [
      'Validator.number()',
      'Validator.number(1, 10)',
      'Validator.boolean()',
      'Validator.array()',
      'Validator.array(1, 10)',
      "Validator.enum(['a', 'b'])",
      'Validator.date()',
      'Validator.object({ city: Validator.text().required() })',
    ]

    for (const expression of textual) {
      const names = completionsAfter(expression)
      expect(names).toContain('trim')
      expect(names).toContain('lowercase')
    }

    for (const expression of others) {
      const names = completionsAfter(expression)
      expect(names).not.toContain('trim')
      expect(names).not.toContain('lowercase')
    }
  })

  test('each transformation disappears once used', () => {
    const afterTrim = completionsAfter('Validator.text().trim()')
    expect(afterTrim).not.toContain('trim')
    expect(afterTrim).toContain('lowercase')

    const afterLowercase = completionsAfter('Validator.text().lowercase()')
    expect(afterLowercase).not.toContain('lowercase')
    expect(afterLowercase).toContain('trim')

    const afterBoth = completionsAfter('Validator.text().trim().lowercase()')
    expect(afterBoth).not.toContain('trim')
    expect(afterBoth).not.toContain('lowercase')
    expect(afterBoth).toContain('required')
  })

  test('transformations are still offered after required() and email()', () => {
    const names = completionsAfter('Validator.text().required().email()')
    expect(names).toContain('trim')
    expect(names).toContain('lowercase')
  })

  test('after .required(), required / nullable are gone', () => {
    expect(completionsAfter('Validator.boolean().required()')).toEqual([])
    expect(completionsAfter('Validator.date().required()')).toEqual([])
    expect(completionsAfter('Validator.text().required()')).toEqual([
      'confirmed',
      'email',
      'lowercase',
      'maxLength',
      'minLength',
      'trim',
      'url',
    ])
  })

  test('after .email(), url is gone (and email itself)', () => {
    const names = completionsAfter('Validator.text().email()')
    expect(names).not.toContain('email')
    expect(names).not.toContain('url')
    expect(names).toContain('minLength')
  })

  test('after .url(), email is gone', () => {
    expect(completionsAfter('Validator.text().url()')).not.toContain('email')
  })

  test('number(1, 10): only presence remains', () => {
    expect(completionsAfter('Validator.number(1, 10)')).toEqual(['nullable', 'required'])
  })
})
