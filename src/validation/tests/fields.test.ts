import { describe, expect, test } from 'bun:test'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

describe('string(min, max)', () => {
  const S = defineSchema({ name: Validator.string(3, 10).required() })

  test('accepts values inside the range, boundaries included', () => {
    expect(Validator.validate({ name: 'abc' }, S).valid).toBe(true)
    expect(Validator.validate({ name: 'abcdefghij' }, S).valid).toBe(true)
  })

  test('rejects too short', () => {
    const r = Validator.validate({ name: 'ab' }, S)
    expect(r.valid).toBe(false)
    expect(r.errors.name).toEqual(['name must be at least 3 characters'])
  })

  test('rejects too long', () => {
    const r = Validator.validate({ name: 'abcdefghijk' }, S)
    expect(r.errors.name).toEqual(['name may not exceed 10 characters'])
  })

  test('rejects non-strings', () => {
    expect(Validator.validate({ name: 123 }, S).errors.name).toEqual(['name must be a string'])
  })

  test('is not valid without both limits (runtime guard for plain JS)', () => {
    const anyValidator = Validator as unknown as { string: (...a: unknown[]) => unknown }
    expect(() => anyValidator.string()).toThrow(TypeError)
    expect(() => anyValidator.string(3)).toThrow(TypeError)
  })
})

describe('text()', () => {
  test('has no default length limits', () => {
    const S = defineSchema({ bio: Validator.text().required() })
    expect(Validator.validate({ bio: 'x' }, S).valid).toBe(true)
    expect(Validator.validate({ bio: 'x'.repeat(100_000) }, S).valid).toBe(true)
  })

  test('rejects non-strings', () => {
    const S = defineSchema({ bio: Validator.text().required() })
    expect(Validator.validate({ bio: 5 }, S).errors.bio).toEqual(['bio must be a string'])
  })
})

describe('number(min, max)', () => {
  const S = defineSchema({ age: Validator.number(18, 100).required() })

  test('accepts the range, boundaries included', () => {
    expect(Validator.validate({ age: 18 }, S).valid).toBe(true)
    expect(Validator.validate({ age: 100 }, S).valid).toBe(true)
  })

  test('rejects below min / above max with the 1.x messages', () => {
    expect(Validator.validate({ age: 17 }, S).errors.age).toEqual(['age must be at least 18'])
    expect(Validator.validate({ age: 101 }, S).errors.age).toEqual([
      'age may not be greater than 100',
    ])
  })

  test('rejects strings, NaN and Infinity', () => {
    for (const bad of ['20', Number.NaN, Number.POSITIVE_INFINITY, true, null]) {
      const r = Validator.validate({ age: bad }, S)
      expect(r.valid).toBe(false)
    }
    expect(Validator.validate({ age: '20' }, S).errors.age).toEqual(['age must be a number'])
  })

  test('number() without limits accepts any finite number', () => {
    const T = defineSchema({ n: Validator.number().required() })
    expect(Validator.validate({ n: -5.5 }, T).valid).toBe(true)
    expect(Validator.validate({ n: 0 }, T).valid).toBe(true)
  })

  test('negative and decimal limits are supported', () => {
    const T = defineSchema({ t: Validator.number(-10.5, 10.5).required() })
    expect(Validator.validate({ t: -10.5 }, T).valid).toBe(true)
    expect(Validator.validate({ t: -10.6 }, T).valid).toBe(false)
  })

  test('0 is a valid value for a required number', () => {
    const T = defineSchema({ n: Validator.number(0, 5).required() })
    expect(Validator.validate({ n: 0 }, T).valid).toBe(true)
  })
})

describe('boolean()', () => {
  const S = defineSchema({ active: Validator.boolean().required() })

  test('accepts true and false', () => {
    expect(Validator.validate({ active: true }, S).valid).toBe(true)
    expect(Validator.validate({ active: false }, S).valid).toBe(true)
  })

  test('rejects other types', () => {
    for (const bad of ['true', 1, 0, [], {}]) {
      expect(Validator.validate({ active: bad }, S).errors.active).toEqual([
        'active must be a boolean',
      ])
    }
  })
})

describe('array(min, max)', () => {
  const S = defineSchema({ tags: Validator.array(1, 3).required() })

  test('accepts sizes inside the range', () => {
    expect(Validator.validate({ tags: ['a'] }, S).valid).toBe(true)
    expect(Validator.validate({ tags: [1, 2, 3] }, S).valid).toBe(true)
  })

  test('rejects too few / too many items', () => {
    expect(Validator.validate({ tags: [] }, S).errors.tags).toEqual([
      'tags must contain at least 1 items',
    ])
    expect(Validator.validate({ tags: [1, 2, 3, 4] }, S).errors.tags).toEqual([
      'tags may not contain more than 3 items',
    ])
  })

  test('rejects non-arrays', () => {
    expect(Validator.validate({ tags: 'a' }, S).errors.tags).toEqual(['tags must be an array'])
    expect(Validator.validate({ tags: {} }, S).errors.tags).toEqual(['tags must be an array'])
  })

  test('array(0, n) accepts an empty array', () => {
    const T = defineSchema({ images: Validator.array(0, 5).required() })
    expect(Validator.validate({ images: [] }, T).valid).toBe(true)
  })

  test('array() without limits accepts any array', () => {
    const T = defineSchema({ list: Validator.array().required() })
    expect(Validator.validate({ list: [] }, T).valid).toBe(true)
    expect(Validator.validate({ list: new Array(1000).fill(0) }, T).valid).toBe(true)
  })
})

describe('enum()', () => {
  const S = defineSchema({ role: Validator.enum(['admin', 'user', 'moderator']).required() })

  test('accepts only listed values', () => {
    expect(Validator.validate({ role: 'admin' }, S).valid).toBe(true)
    expect(Validator.validate({ role: 'moderator' }, S).valid).toBe(true)
  })

  test('is strict and case-sensitive, with no coercion', () => {
    for (const bad of ['Admin', 'root', 1, true, []]) {
      expect(Validator.validate({ role: bad }, S).errors.role).toEqual([
        'role must be one of: admin, user, moderator',
      ])
    }
  })

  test('rejects an empty list, empty / whitespace options, duplicates and non-strings', () => {
    const e = Validator as unknown as { enum: (o: unknown) => unknown }
    expect(() => e.enum([])).toThrow(TypeError)
    expect(() => e.enum(['a', ''])).toThrow(TypeError)
    expect(() => e.enum(['a', '  '])).toThrow(TypeError)
    expect(() => e.enum(['a', 'a'])).toThrow(TypeError)
    expect(() => e.enum([1, 2])).toThrow(TypeError)
    expect(() => e.enum('a,b')).toThrow(TypeError)
  })

  test('mutating the original options array afterwards does not affect the validator', () => {
    const options: [string, ...string[]] = ['a', 'b']
    const T = defineSchema({ v: Validator.enum(options).required() })
    options.push('c')
    expect(Validator.validate({ v: 'c' }, T).valid).toBe(false)
  })
})
