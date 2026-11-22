import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ErrorMessages } from '../src/errors/errors-messages'
import { FieldBuilder } from '../src/validation/field-builder'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

const Address = defineSchema({
  user: Validator.object({
    name: Validator.string(3, 50).required(),
    address: Validator.object({
      city: Validator.string(2, 100).required(),
      country: Validator.string(2, 100).required(),
    }).required(),
  }).required(),
})

const UserSchema = defineSchema({
  name: Validator.string(3, 50).required(),
  address: Validator.object({
    city: Validator.string(2, 100).required(),
    country: Validator.string(2, 100).required(),
  }).required(),
})

const validBody = () => ({ name: 'Zen', address: { city: 'Gaziantep', country: 'Turkey' } })

describe('object(): valid values', () => {
  test('a valid nested object passes', () => {
    const body = validBody()
    const r = Validator.validate(body, UserSchema)

    expect(r.valid).toBe(true)
    expect(r.errors).toEqual({})
    if (r.valid) {
      expect(r.data).toEqual({ name: 'Zen', address: { city: 'Gaziantep', country: 'Turkey' } })
      expect(r.data.address.city).toBe('Gaziantep')
    }
  })

  test('nothing is copied when no value had to change (same objects, like 1.x)', () => {
    const body = validBody()
    const r = Validator.validate(body, UserSchema)

    if (!r.valid) throw new Error('expected a valid result')
    expect(r.data).toBe(body)
    expect(r.data.address).toBe(body.address)
  })

  test('keys that are not in the shape are validated by nobody and kept, as at the top level', () => {
    const body = {
      name: 'Zen',
      address: { city: 'Gaziantep', country: 'Turkey', zip: '27000' },
      x: 1,
    }
    const r = Validator.validate(body, UserSchema)

    expect(r.valid).toBe(true)
    if (r.valid) expect(r.data).toEqual(body)
  })

  test('an object with a null prototype is a plain object too', () => {
    const address = Object.assign(Object.create(null), { city: 'Gaziantep', country: 'Turkey' })

    expect(Validator.validate({ name: 'Zen', address }, UserSchema).valid).toBe(true)
  })

  test('an empty shape accepts any plain object', () => {
    const S = defineSchema({ meta: Validator.object({}).required() })

    expect(Validator.validate({ meta: {} }, S).valid).toBe(true)
    expect(Validator.validate({ meta: { a: 1 } }, S).valid).toBe(true)
    expect(Validator.validate({ meta: [] }, S).valid).toBe(false)
  })
})

describe('object(): values that are not objects', () => {
  const notObjects: [string, unknown][] = [
    ['a string', 'Gaziantep'],
    ['a number', 42],
    ['zero', 0],
    ['a boolean', false],
    ['an array', [{ city: 'x', country: 'y' }]],
    ['an empty array', []],
    ['a Date', new Date()],
    ['a Map', new Map()],
    ['a class instance', new (class Point {})()],
    ['a function', () => ({})],
  ]

  for (const [label, value] of notObjects) {
    test(`rejects ${label}`, () => {
      const r = Validator.validate({ name: 'Zen', address: value }, UserSchema)

      expect(r.valid).toBe(false)
      // one error, on the object itself: the nested fields are not reported on top of it
      expect(r.errors).toEqual({ address: ['address must be an object'] })
    })
  }

  test('null is "required" for a required object, a type error otherwise', () => {
    expect(Validator.validate({ name: 'Zen', address: null }, UserSchema).errors).toEqual({
      address: ['address is required'],
    })

    // neither required nor nullable (plain JS only): null is simply not an object
    const unset = { o: Validator.object({}) } as never
    expect(Validator.validate({ o: null }, unset).errors).toEqual({ o: ['o must be an object'] })
  })
})

describe('object(): nested fields are validated', () => {
  test('every rule of the inner fields applies', () => {
    const r = Validator.validate(
      { name: 'Zen', address: { city: 'G', country: 'T'.repeat(101) } },
      UserSchema,
    )

    expect(r.valid).toBe(false)
    expect(r.errors).toEqual({
      'address.city': ['address.city must be at least 2 characters'],
      'address.country': ['address.country may not exceed 100 characters'],
    })
  })

  test('missing and blank inner fields are required errors', () => {
    expect(Validator.validate({ name: 'Zen', address: {} }, UserSchema).errors).toEqual({
      'address.city': ['address.city is required'],
      'address.country': ['address.country is required'],
    })

    expect(
      Validator.validate({ name: 'Zen', address: { city: '  ', country: null } }, UserSchema)
        .errors,
    ).toEqual({
      'address.city': ['address.city is required'],
      'address.country': ['address.country is required'],
    })
  })

  test('outer and inner errors are all reported together', () => {
    const r = Validator.validate({ name: 'Z', address: { city: 'G' } }, UserSchema)

    expect(r.errors).toEqual({
      name: ['name must be at least 3 characters'],
      'address.city': ['address.city must be at least 2 characters'],
      'address.country': ['address.country is required'],
    })
  })

  test('the key of an error identifies the failing field', () => {
    const r = Validator.validate(
      { name: 'Zen', address: { city: 'Gaziantep', country: 'T' } },
      UserSchema,
    )

    expect(Object.keys(r.errors)).toEqual(['address.country'])
  })

  test('a failing nested object yields no data', () => {
    const r = Validator.validate({ name: 'Zen', address: {} }, UserSchema)

    expect('data' in r).toBe(false)
  })

  test('every kind of field works inside an object', () => {
    const S = defineSchema({
      all: Validator.object({
        s: Validator.string(2, 5).required(),
        t: Validator.text().required(),
        n: Validator.number(1, 10).required(),
        b: Validator.boolean().required(),
        a: Validator.array(1, 2).required(),
        e: Validator.enum(['x', 'y']).required(),
        d: Validator.date().required(),
        o: Validator.object({ k: Validator.text().required() }).required(),
      }).required(),
    })

    const good = {
      s: 'abc',
      t: 'text',
      n: 5,
      b: false,
      a: [1],
      e: 'x',
      d: '2026-01-31',
      o: { k: 'v' },
    }
    expect(Validator.validate({ all: good }, S).valid).toBe(true)

    const bad = { s: 'a', t: 1, n: 11, b: 'no', a: [], e: 'z', d: 'nope', o: {} }
    expect(Validator.validate({ all: bad }, S).errors).toEqual({
      'all.s': ['all.s must be at least 2 characters'],
      'all.t': ['all.t must be a string'],
      'all.n': ['all.n may not be greater than 10'],
      'all.b': ['all.b must be a boolean'],
      'all.a': ['all.a must contain at least 1 items'],
      'all.e': ['all.e must be one of: x, y'],
      'all.d': ['all.d must be a valid date'],
      'all.o.k': ['all.o.k is required'],
    })
  })

  test('the rules that need the field name work with the local name', () => {
    const S = defineSchema({
      account: Validator.object({
        email: Validator.text().required().email(),
        password: Validator.string(8, 40).required().confirmed(),
      }).required(),
    })

    expect(
      Validator.validate(
        { account: { email: 'a@b.co', password: '12345678', passwordConfirmation: '12345678' } },
        S,
      ).valid,
    ).toBe(true)

    // the confirmation is looked up NEXT TO the field, not at the top level
    expect(
      Validator.validate(
        { account: { email: 'a@b.co', password: '12345678' }, passwordConfirmation: '12345678' },
        S,
      ).errors,
    ).toEqual({ 'account.password': ['account.password confirmation does not match'] })

    expect(
      Validator.validate(
        { account: { email: 'nope', password: '12345678', passwordConfirmation: '12345678' } },
        S,
      ).errors,
    ).toEqual({
      'account.email': ['account.email must be a valid email'],
    })
  })
})

describe('object(): several levels of nesting', () => {
  test('a valid three-level object passes', () => {
    const body = { user: { name: 'Zen', address: { city: 'Gaziantep', country: 'Turkey' } } }

    expect(Validator.validate(body, Address).valid).toBe(true)
  })

  test('errors carry the whole path', () => {
    const r = Validator.validate({ user: { name: 'Z', address: { city: 'G' } } }, Address)

    expect(r.errors).toEqual({
      'user.name': ['user.name must be at least 3 characters'],
      'user.address.city': ['user.address.city must be at least 2 characters'],
      'user.address.country': ['user.address.country is required'],
    })
  })

  test('a non-object at an inner level is reported at that level', () => {
    expect(Validator.validate({ user: { name: 'Zen', address: 'home' } }, Address).errors).toEqual({
      'user.address': ['user.address must be an object'],
    })

    expect(Validator.validate({ user: 'Zen' }, Address).errors).toEqual({
      user: ['user must be an object'],
    })
  })

  test('four levels deep', () => {
    const S = defineSchema({
      a: Validator.object({
        b: Validator.object({
          c: Validator.object({ d: Validator.number(1, 3).required() }).required(),
        }).required(),
      }).required(),
    })

    expect(Validator.validate({ a: { b: { c: { d: 2 } } } }, S).valid).toBe(true)
    expect(Validator.validate({ a: { b: { c: { d: 9 } } } }, S).errors).toEqual({
      'a.b.c.d': ['a.b.c.d may not be greater than 3'],
    })
  })
})

describe('object(): required / nullable', () => {
  const Req = defineSchema({ o: Validator.object({ k: Validator.text().required() }).required() })
  const Nul = defineSchema({ o: Validator.object({ k: Validator.text().required() }).nullable() })

  test('required rejects undefined, null, blank strings — without nested noise', () => {
    for (const body of [{}, { o: undefined }, { o: null }, { o: '' }, { o: '   ' }]) {
      expect(Validator.validate(body, Req).errors).toEqual({ o: ['o is required'] })
    }
  })

  test('required keeps an empty object valid when no inner field is required', () => {
    const S = defineSchema({ o: Validator.object({ k: Validator.text().nullable() }).required() })

    expect(Validator.validate({ o: {} }, S).valid).toBe(true)
  })

  test('nullable accepts undefined, null and blank strings', () => {
    for (const body of [{}, { o: undefined }, { o: null }, { o: '' }, { o: '  ' }]) {
      expect(Validator.validate(body, Nul).valid).toBe(true)
    }
  })

  test('nullable still validates an object that is present', () => {
    expect(Validator.validate({ o: { k: 'v' } }, Nul).valid).toBe(true)
    expect(Validator.validate({ o: {} }, Nul).errors).toEqual({ 'o.k': ['o.k is required'] })
    expect(Validator.validate({ o: 5 }, Nul).errors).toEqual({ o: ['o must be an object'] })
  })

  test('nullable null is returned as null; an absent key stays absent', () => {
    const withNull = Validator.validate({ o: null }, Nul)
    const absent = Validator.validate({}, Nul)

    if (!withNull.valid || !absent.valid) throw new Error('expected valid results')
    expect(withNull.data).toEqual({ o: null })
    expect('o' in absent.data).toBe(false)
  })

  test('nullable inner fields are optional', () => {
    const S = defineSchema({
      o: Validator.object({
        k: Validator.text().required(),
        note: Validator.text().nullable(),
      }).required(),
    })

    expect(Validator.validate({ o: { k: 'v' } }, S).valid).toBe(true)
    expect(Validator.validate({ o: { k: 'v', note: null } }, S).valid).toBe(true)
  })
})

describe('object(): building and compiling', () => {
  afterEach(() => Validator.configure(new ErrorMessages()))

  test('the shape is copied and frozen: changing the original afterwards has no effect', () => {
    const shape: Record<string, unknown> = { city: Validator.text().required() }
    const builder = Validator.object(shape as never)

    shape.extra = Validator.text().required()

    const def = (builder as unknown as FieldBuilder).definition
    expect(Object.keys(def.shape ?? {})).toEqual(['city'])
    expect(Object.isFrozen(def.shape)).toBe(true)
  })

  test('object() is immutable like every other builder', () => {
    const base = Validator.object({ k: Validator.text().required() })
    const required = base.required()

    expect(required).not.toBe(base)
    expect(Object.isFrozen(base)).toBe(true)
    expect((base as unknown as FieldBuilder).definition.required).toBe(false)
  })

  test('a non-object shape is rejected immediately', () => {
    const object = Validator.object as unknown as (shape: unknown) => unknown

    for (const bad of [undefined, null, 'city', 5, [], [Validator.text()]]) {
      expect(() => object(bad)).toThrow(TypeError)
    }
  })

  test('a value that is not a validator is reported with its full path', () => {
    const S = {
      o: Validator.object({
        inner: Validator.object({ city: 'required' } as never).required(),
      }).required(),
    }

    expect(() => Validator.validate({}, S as never)).toThrow(/"o\.inner\.city"/)
    expect(() => Validator.validate({}, S as never)).toThrow(/removed in VentJS/)
  })

  test('required + nullable inside an object is rejected with the full path', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const bad = Validator.text().required() as unknown as { nullable: () => never }
      const S = { o: Validator.object({ city: bad.nullable() }).required() }

      expect(() => Validator.validate({ o: {} }, S as never)).toThrow(
        '[VentJS] Invalid rules for field "o.city".',
      )
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(String(consoleError.mock.calls[0]?.[0])).toContain('"o.city"')
    } finally {
      consoleError.mockRestore()
    }
  })

  test('configure() custom messages receive the full path', () => {
    class Custom extends ErrorMessages {
      override invalidValidationSchema(field: string): string {
        return `custom: ${field}`
      }
    }
    Validator.configure(new Custom())

    const consoleError = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const bad = Validator.text().required() as unknown as { nullable: () => never }
      const S = { o: Validator.object({ city: bad.nullable() }).required() }

      expect(() => Validator.validate({}, S as never)).toThrow()
      expect(consoleError).toHaveBeenCalledWith('custom: o.city')
    } finally {
      consoleError.mockRestore()
    }
  })

  test('the same inner builders can feed two objects; paths keep them apart', () => {
    const fields = {
      city: Validator.string(2, 100).required(),
      country: Validator.string(2, 100).required(),
    }
    const S = defineSchema({
      billing: Validator.object(fields).required(),
      shipping: Validator.object(fields).nullable(),
    })

    const r = Validator.validate({ billing: { city: 'x' }, shipping: { country: 'y' } }, S)
    expect(r.errors).toEqual({
      'billing.city': ['billing.city must be at least 2 characters'],
      'billing.country': ['billing.country is required'],
      'shipping.city': ['shipping.city is required'],
      'shipping.country': ['shipping.country must be at least 2 characters'],
    })
  })

  test('a nested schema is compiled once, together with its parent', () => {
    // a schema nobody has used yet (the shared ones above are already in the cache)
    const Fresh = defineSchema({
      address: Validator.object({ city: Validator.string(2, 100).required() }).required(),
    })
    const body = () => ({ address: { city: 'Gaziantep' } })
    const entries = spyOn(Object, 'entries')

    try {
      Validator.validate(body(), Fresh)
      const afterFirst = entries.mock.calls.length
      // the parent and the nested shape are both compiled by that first call
      expect(afterFirst).toBeGreaterThanOrEqual(2)

      for (let i = 0; i < 50; i++) Validator.validate(body(), Fresh)
      expect(entries.mock.calls.length).toBe(afterFirst)
    } finally {
      entries.mockRestore()
    }
  })

  test('validating does not mutate the input, even when nested values are rewritten', () => {
    const S = defineSchema({
      o: Validator.object({
        email: Validator.text().required().email().trim().lowercase(),
      }).required(),
    })
    const body = { o: { email: '  A@B.CO ' } }
    const snapshot = structuredClone(body)

    const r = Validator.validate(body, S)

    expect(body).toEqual(snapshot)
    if (!r.valid) throw new Error('expected a valid result')
    expect(r.data).toEqual({ o: { email: 'a@b.co' } })
    expect(r.data).not.toBe(body)
    expect(r.data.o).not.toBe(body.o)
  })

  test('only the path that changed is copied; untouched siblings keep their identity', () => {
    const S = defineSchema({
      left: Validator.object({ email: Validator.text().required().trim() }).required(),
      right: Validator.object({ email: Validator.text().required().trim() }).required(),
      other: Validator.object({ k: Validator.text().required() }).required(),
    })
    const body = { left: { email: ' a@b.co ' }, right: { email: 'c@d.co' }, other: { k: 'v' } }

    const r = Validator.validate(body, S)
    if (!r.valid) throw new Error('expected a valid result')

    expect(r.data.left).not.toBe(body.left)
    expect(r.data.left.email).toBe('a@b.co')
    expect(r.data.right).toBe(body.right)
    expect(r.data.other).toBe(body.other)
  })
})
