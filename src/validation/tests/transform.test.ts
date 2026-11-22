import { describe, expect, test } from 'bun:test'
import { FieldBuilder } from '../src/validation/field-builder'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

type Loose = Record<string, (...args: unknown[]) => unknown>
const loose = (b: unknown): Loose => b as Loose

const UserSchema = defineSchema({
  email: Validator.text().required().email().trim().lowercase(),
})

function dataOf<T>(r: { valid: boolean; errors: unknown } & { data?: T }): T {
  if (!r.valid || r.data === undefined) throw new Error(`expected a valid result: ${JSON.stringify(r.errors)}`)

  return r.data
}

describe('the example from the task', () => {
  test("'  ZEN@EXAMPLE.COM  ' becomes 'zen@example.com'", () => {
    const result = Validator.validate({ email: '  ZEN@EXAMPLE.COM  ' }, UserSchema)

    expect(result.valid).toBe(true)
    expect(dataOf(result)).toEqual({ email: 'zen@example.com' })
  })
})

describe('trim()', () => {
  const S = defineSchema({ v: Validator.text().required().trim() })

  test('removes whitespace from both ends only', () => {
    expect(dataOf(Validator.validate({ v: '   hello world   ' }, S))).toEqual({ v: 'hello world' })
    expect(dataOf(Validator.validate({ v: '\t\n a b \r\n' }, S))).toEqual({ v: 'a b' })
  })

  test('uses the same definition of whitespace as String.prototype.trim', () => {
    expect(dataOf(Validator.validate({ v: '\u00A0\uFEFFabc\u2003' }, S))).toEqual({ v: 'abc' })
  })

  test('leaves already clean values untouched', () => {
    expect(dataOf(Validator.validate({ v: 'abc' }, S))).toEqual({ v: 'abc' })
  })

  test('does not change case', () => {
    expect(dataOf(Validator.validate({ v: '  AbC ' }, S))).toEqual({ v: 'AbC' })
  })
})

describe('lowercase()', () => {
  const S = defineSchema({ v: Validator.text().required().lowercase() })

  test('lowercases every letter', () => {
    expect(dataOf(Validator.validate({ v: 'HeLLo WORLD 123' }, S))).toEqual({ v: 'hello world 123' })
  })

  test('handles non-ASCII letters', () => {
    expect(dataOf(Validator.validate({ v: 'ÀÉÎ ÇĞÖŞÜ' }, S))).toEqual({ v: 'àéî çğöşü' })
  })

  test('does not trim', () => {
    expect(dataOf(Validator.validate({ v: '  ABC  ' }, S))).toEqual({ v: '  abc  ' })
  })
})

describe('trim() + lowercase()', () => {
  test('both are applied', () => {
    const S = defineSchema({ v: Validator.text().required().trim().lowercase() })

    expect(dataOf(Validator.validate({ v: '  HeLLo  ' }, S))).toEqual({ v: 'hello' })
  })

  test('the order of the calls does not matter', () => {
    const a = defineSchema({ v: Validator.text().required().trim().lowercase() })
    const b = defineSchema({ v: Validator.text().required().lowercase().trim() })
    const c = defineSchema({ v: Validator.text().lowercase().required().trim() })
    const d = defineSchema({ v: Validator.text().trim().required().lowercase() })

    for (const value of ['  HeLLo ', 'ABC', ' x ', '   ', '', 5]) {
      const expected = Validator.validate({ v: value }, a)

      for (const other of [b, c, d]) {
        expect(Validator.validate({ v: value }, other)).toEqual(expected)
      }
    }
  })

  test('works on string(min, max) as well', () => {
    const S = defineSchema({ name: Validator.string(3, 10).trim().lowercase().required() })

    expect(dataOf(Validator.validate({ name: '  ABCDE  ' }, S))).toEqual({ name: 'abcde' })
  })
})

describe('transformations run BEFORE the checks', () => {
  test('email() sees the cleaned value', () => {
    expect(Validator.validate({ email: ' a@b.co ' }, UserSchema).valid).toBe(true)
    expect(Validator.validate({ email: ' not an email ' }, UserSchema).errors).toEqual({
      email: ['email must be a valid email'],
    })
  })

  test('url() sees the cleaned value', () => {
    const S = defineSchema({ site: Validator.text().required().url().trim().lowercase() })

    expect(dataOf(Validator.validate({ site: '  HTTPS://Example.COM/Path  ' }, S))).toEqual({
      site: 'https://example.com/path',
    })
  })

  test('length limits count the cleaned value', () => {
    const S = defineSchema({ v: Validator.string(3, 5).trim().required() })

    expect(Validator.validate({ v: '  ab  ' }, S).errors).toEqual({
      v: ['v must be at least 3 characters'],
    })
    expect(Validator.validate({ v: '  abcdef  ' }, S).errors).toEqual({
      v: ['v may not exceed 5 characters'],
    })
    expect(Validator.validate({ v: '  abc  ' }, S).valid).toBe(true)
  })

  test('enum-like checks are not affected: enum() has no transformations', () => {
    const S = defineSchema({ role: Validator.enum(['admin']).required() })

    expect(Validator.validate({ role: ' admin ' }, S).valid).toBe(false)
  })
})

describe('transformations next to required() / nullable()', () => {
  test('required still rejects blank values, with or without trim()', () => {
    const plain = defineSchema({ v: Validator.text().required() })
    const trimmed = defineSchema({ v: Validator.text().required().trim() })

    for (const value of ['', '   ', null, undefined]) {
      expect(Validator.validate({ v: value }, plain).errors).toEqual({ v: ['v is required'] })
      expect(Validator.validate({ v: value }, trimmed).errors).toEqual({ v: ['v is required'] })
    }
  })

  test('required + email + transformations report only what is wrong', () => {
    expect(Validator.validate({ email: '   ' }, UserSchema).errors).toEqual({ email: ['email is required'] })
    expect(Validator.validate({}, UserSchema).errors).toEqual({ email: ['email is required'] })
  })

  test('nullable: a real value is transformed and checked', () => {
    const S = defineSchema({ email: Validator.text().nullable().email().trim().lowercase() })

    expect(dataOf(Validator.validate({ email: ' A@B.CO ' }, S))).toEqual({ email: 'a@b.co' })
    expect(Validator.validate({ email: ' nope ' }, S).errors).toEqual({
      email: ['email must be a valid email'],
    })
  })

  test('nullable: a blank value is valid and comes back trimmed', () => {
    const S = defineSchema({ v: Validator.text().nullable().trim() })

    expect(dataOf(Validator.validate({ v: '   ' }, S))).toEqual({ v: '' })
    expect(dataOf(Validator.validate({ v: '' }, S))).toEqual({ v: '' })
  })

  test('nullable: absent and null are left exactly as they were', () => {
    const S = defineSchema({ v: Validator.text().nullable().trim().lowercase() })

    const absent = dataOf(Validator.validate({}, S))
    expect('v' in absent).toBe(false)
    expect(dataOf(Validator.validate({ v: null }, S))).toEqual({ v: null })
  })

  test('nullable without trim(): a blank value is returned as it came', () => {
    const S = defineSchema({ v: Validator.text().nullable().lowercase() })
    const body = { v: '   ' }
    const r = Validator.validate(body, S)

    expect(dataOf(r)).toBe(body)
  })
})

describe('values that are not strings', () => {
  test('are rejected by the type check and never transformed', () => {
    for (const value of [123, true, {}, [], ['A']]) {
      expect(Validator.validate({ email: value }, UserSchema).errors).toEqual({
        email: ['email must be a string'],
      })
    }
  })
})

describe('the result', () => {
  test('the input object is never modified', () => {
    const body = { email: '  ZEN@EXAMPLE.COM  ', other: 1 }
    const r = Validator.validate(body, UserSchema)

    expect(body).toEqual({ email: '  ZEN@EXAMPLE.COM  ', other: 1 })
    expect(dataOf(r)).not.toBe(body)
  })

  test('other keys are carried over unchanged', () => {
    const r = Validator.validate({ email: 'A@B.CO', other: { nested: [1] }, flag: true }, UserSchema)
    // keys outside the schema are not part of the inferred type, so compare as a plain record
    const data: Record<string, unknown> = dataOf(r)

    expect(data).toEqual({ email: 'a@b.co', other: { nested: [1] }, flag: true })
  })

  test('data is the very same object when there was nothing to change', () => {
    const body = { email: 'zen@example.com' }
    const r = Validator.validate(body, UserSchema)

    expect(dataOf(r)).toBe(body)
  })

  test('only one copy is made, however many fields change', () => {
    const S = defineSchema({
      a: Validator.text().required().trim(),
      b: Validator.text().required().lowercase(),
      c: Validator.text().required().trim().lowercase(),
    })
    const r = Validator.validate({ a: ' A ', b: 'B', c: ' C ' }, S)

    expect(dataOf(r)).toEqual({ a: 'A', b: 'b', c: 'c' })
  })

  test('the same schema keeps working for many different bodies (no state is shared)', () => {
    for (let i = 0; i < 20; i++) {
      const r = Validator.validate({ email: `  USER${i}@EXAMPLE.COM ` }, UserSchema)

      expect(dataOf(r)).toEqual({ email: `user${i}@example.com` })
    }
  })

  test('failed validation returns the errors and no data', () => {
    const r = Validator.validate({ email: '  NOPE ' }, UserSchema)

    expect(r.valid).toBe(false)
    expect('data' in r).toBe(false)
  })
})

describe('confirmed() with transformations', () => {
  const S = defineSchema({ password: Validator.string(8, 40).required().confirmed().trim() })

  test('the confirmation is normalized the same way, so equal values match', () => {
    const r = Validator.validate({ password: ' secret123 ', passwordConfirmation: 'secret123' }, S)

    expect(dataOf(r).password).toBe('secret123')
  })

  test('different values still do not match', () => {
    expect(
      Validator.validate({ password: ' secret123 ', passwordConfirmation: 'secret124' }, S).errors,
    ).toEqual({ password: ['password confirmation does not match'] })
    expect(Validator.validate({ password: 'secret123' }, S).errors).toEqual({
      password: ['password confirmation does not match'],
    })
  })

  test('lowercase() applies to the confirmation as well', () => {
    const L = defineSchema({ password: Validator.string(8, 40).required().confirmed().lowercase() })

    expect(Validator.validate({ password: 'SECRET123', passwordConfirmation: 'secret123' }, L).valid).toBe(true)
  })

  test('a field without transformations compares the raw values, exactly as in 1.x', () => {
    const P = defineSchema({ password: Validator.string(8, 40).required().confirmed() })

    expect(Validator.validate({ password: 'secret123', passwordConfirmation: ' secret123' }, P).valid).toBe(false)
  })
})

describe('trim() / lowercase() are text-only (runtime guard for plain JS)', () => {
  const builders: [string, unknown][] = [
    ['number', Validator.number()],
    ['number', Validator.number(1, 10)],
    ['boolean', Validator.boolean()],
    ['array', Validator.array()],
    ['array', Validator.array(1, 10)],
    ['enum', Validator.enum(['a', 'b'])],
    ['date', Validator.date()],
    ['object', Validator.object({ k: Validator.text().required() })],
  ]

  for (const [kind, builder] of builders) {
    test(`not available on a "${kind}" validator`, () => {
      expect(() => loose(builder).trim!()).toThrow(new RegExp(`Rule "trim" is not available on a "${kind}" validator`))
      expect(() => loose(builder).lowercase!()).toThrow(
        new RegExp(`Rule "lowercase" is not available on a "${kind}" validator`),
      )
    })
  }

  test('string() and text() accept them', () => {
    expect(() => Validator.string(3, 50).trim().lowercase()).not.toThrow()
    expect(() => Validator.text().trim().lowercase()).not.toThrow()
  })

  test('each can be applied once', () => {
    expect(() => loose(Validator.text().trim()).trim!()).toThrow(/already defined/)
    expect(() => loose(Validator.text().lowercase()).lowercase!()).toThrow(/already defined/)
  })

  test('builders stay immutable', () => {
    const base = Validator.text()
    const trimmed = base.trim()

    expect(trimmed).not.toBe(base)
    expect(Object.isFrozen(trimmed)).toBe(true)
    expect((base as unknown as FieldBuilder).definition.trim).toBe(false)
    expect((trimmed as unknown as FieldBuilder).definition.trim).toBe(true)
  })

  test('one partial builder can feed several fields', () => {
    const clean = Validator.text().trim().lowercase()
    const S = defineSchema({ first: clean.required(), second: clean.nullable() })

    expect(dataOf(Validator.validate({ first: ' A ', second: ' B ' }, S))).toEqual({ first: 'a', second: 'b' })
  })
})
