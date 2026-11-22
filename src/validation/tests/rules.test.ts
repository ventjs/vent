import { describe, expect, test } from 'bun:test'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

describe('required / nullable', () => {
  const Req = defineSchema({ v: Validator.text().required() })
  const Nul = defineSchema({ v: Validator.text().nullable() })

  test('required rejects undefined, null, empty and whitespace-only strings', () => {
    for (const body of [{}, { v: undefined }, { v: null }, { v: '' }, { v: '   ' }]) {
      expect(Validator.validate(body, Req).errors.v).toEqual(['v is required'])
    }
  })

  test('required keeps falsy-but-present values valid', () => {
    const N = defineSchema({ n: Validator.number().required(), b: Validator.boolean().required() })
    expect(Validator.validate({ n: 0, b: false }, N).valid).toBe(true)
  })

  test('required stops at "is required" (no type errors on top)', () => {
    const S = defineSchema({ v: Validator.string(3, 10).required() })
    expect(Validator.validate({ v: '' }, S).errors.v).toEqual(['v is required'])
  })

  test('nullable accepts undefined, null and blank strings, and still checks real values', () => {
    for (const body of [{}, { v: null }, { v: '' }, { v: '  ' }]) {
      expect(Validator.validate(body, Nul).valid).toBe(true)
    }
    const S = defineSchema({ v: Validator.string(3, 5).nullable() })
    expect(Validator.validate({ v: 'ab' }, S).valid).toBe(false)
    expect(Validator.validate({ v: 'abcd' }, S).valid).toBe(true)
  })

  test('nullable applies to every kind', () => {
    const S = defineSchema({
      n: Validator.number(1, 5).nullable(),
      b: Validator.boolean().nullable(),
      a: Validator.array(1, 2).nullable(),
      e: Validator.enum(['x', 'y']).nullable(),
    })
    expect(Validator.validate({ n: null, b: null, a: null, e: null }, S).valid).toBe(true)
    expect(Validator.validate({}, S).valid).toBe(true)
    expect(Validator.validate({ n: 9 }, S).valid).toBe(false)
    expect(Validator.validate({ e: 'z' }, S).valid).toBe(false)
  })

  test('required + nullable together is rejected when the schema is first used', () => {
    const calls: string[] = []
    const original = console.error
    console.error = (...a: unknown[]) => void calls.push(String(a[0]))

    try {
      // Reachable only by bypassing the types: they hide .nullable() after .required()
      const bad = Validator.text().required() as unknown as { nullable: () => never }
      const schema = { v: bad.nullable() }
      expect(() => Validator.validate({}, schema as never)).toThrow(
        '[VentJS] Invalid rules for field "v".',
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('"v"')
    } finally {
      console.error = original
    }
  })
})

describe('email', () => {
  const S = defineSchema({ email: Validator.text().required().email() })

  test('accepts valid emails', () => {
    for (const ok of ['a@b.co', 'first.last@example.com', 'a+tag@sub.example.org']) {
      expect(Validator.validate({ email: ok }, S).valid).toBe(true)
    }
  })

  test('rejects invalid emails', () => {
    for (const bad of ['plain', 'a@b', '@b.com', 'a@.com', 'a b@c.com', 'a@b@c.com']) {
      expect(Validator.validate({ email: bad }, S).errors.email).toEqual([
        'email must be a valid email',
      ])
    }
  })

  test('works on a field whose name merely contains "email"', () => {
    const T = defineSchema({ contactEmail: Validator.text().nullable().email() })
    expect(Validator.validate({ contactEmail: 'x' }, T).valid).toBe(false)
    expect(Validator.validate({ contactEmail: null }, T).valid).toBe(true)
  })
})

describe('url', () => {
  const S = defineSchema({ website: Validator.text().required().url() })

  test('accepts http and https URLs', () => {
    for (const ok of ['http://a.com', 'https://a.com/path?x=1#h', 'https://localhost:3000']) {
      expect(Validator.validate({ website: ok }, S).valid).toBe(true)
    }
  })

  test('rejects malformed values', () => {
    for (const bad of [
      'a.com',
      'http:example.com',
      'http:///x',
      ' https://a.com',
      'https://a .com',
    ]) {
      expect(Validator.validate({ website: bad }, S).errors.website).toEqual([
        'website must be a valid URL',
      ])
    }
  })

  test('rejects other protocols with a dedicated message', () => {
    for (const bad of ['ftp://a.com', 'javascript:alert(1)', 'mailto:a@b.com']) {
      expect(Validator.validate({ website: bad }, S).errors.website).toEqual([
        'website URL must use http or https',
      ])
    }
  })

  test('nullable url may be omitted', () => {
    const T = defineSchema({ website: Validator.text().nullable().url() })
    expect(Validator.validate({}, T).valid).toBe(true)
  })
})

describe('minLength / maxLength', () => {
  test('work through chaining on text()', () => {
    const S = defineSchema({ v: Validator.text().minLength(2).maxLength(4).required() })
    expect(Validator.validate({ v: 'a' }, S).errors.v).toEqual(['v must be at least 2 characters'])
    expect(Validator.validate({ v: 'abcde' }, S).errors.v).toEqual([
      'v may not exceed 4 characters',
    ])
    expect(Validator.validate({ v: 'abc' }, S).valid).toBe(true)
  })

  test('one-sided limits', () => {
    const OnlyMin = defineSchema({ v: Validator.text().minLength(3).required() })
    const OnlyMax = defineSchema({ v: Validator.text().maxLength(3).required() })
    expect(Validator.validate({ v: 'x'.repeat(500) }, OnlyMin).valid).toBe(true)
    expect(Validator.validate({ v: 'xxxx' }, OnlyMax).valid).toBe(false)
  })

  test('chaining also works on string(), for the rules it has not used', () => {
    const S = defineSchema({ v: Validator.string(2, 4).required().url() })
    expect(Validator.validate({ v: 'https://a.com' }, S).valid).toBe(false)
  })
})

describe('min / max / minItems / maxItems through chaining', () => {
  test('number', () => {
    const S = defineSchema({ n: Validator.number().min(1).max(5).required() })
    expect(Validator.validate({ n: 0 }, S).errors.n).toEqual(['n must be at least 1'])
    expect(Validator.validate({ n: 6 }, S).errors.n).toEqual(['n may not be greater than 5'])
    expect(Validator.validate({ n: 3 }, S).valid).toBe(true)
  })

  test('array', () => {
    const S = defineSchema({ a: Validator.array().minItems(1).maxItems(2).required() })
    expect(Validator.validate({ a: [] }, S).valid).toBe(false)
    expect(Validator.validate({ a: [1, 2, 3] }, S).valid).toBe(false)
    expect(Validator.validate({ a: [1] }, S).valid).toBe(true)
  })

  test('one-sided limits', () => {
    const S = defineSchema({ n: Validator.number().min(10).required() })
    expect(Validator.validate({ n: 1e9 }, S).valid).toBe(true)
  })
})

describe('confirmed', () => {
  const S = defineSchema({ password: Validator.string(8, 40).required().confirmed() })

  test('matches `${field}Confirmation`', () => {
    expect(
      Validator.validate({ password: '12345678', passwordConfirmation: '12345678' }, S).valid,
    ).toBe(true)
  })

  test('rejects a mismatch', () => {
    const r = Validator.validate({ password: '12345678', passwordConfirmation: '87654321' }, S)
    expect(r.errors.password).toEqual(['password confirmation does not match'])
  })

  test('rejects a missing confirmation', () => {
    const r = Validator.validate({ password: '12345678' }, S)
    expect(r.errors.password).toEqual(['password confirmation does not match'])
  })

  test('the 1.x password example (8-40 chars) behaves the same', () => {
    expect(
      Validator.validate({ password: 'short', passwordConfirmation: 'short' }, S).errors.password,
    ).toEqual(['password must be at least 8 characters'])
  })

  test('confirmed can be combined with chaining limits on text()', () => {
    const T = defineSchema({ password: Validator.text().minLength(8).required().confirmed() })
    expect(
      Validator.validate({ password: '12345678', passwordConfirmation: '12345678' }, T).valid,
    ).toBe(true)
  })
})

describe('several errors on one field', () => {
  test('are all reported, in a stable order', () => {
    const S = defineSchema({ email: Validator.text().minLength(10).required().email() })
    expect(Validator.validate({ email: 'abc' }, S).errors.email).toEqual([
      'email must be a valid email',
      'email must be at least 10 characters',
    ])
  })
})
