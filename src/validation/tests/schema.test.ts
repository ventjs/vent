import { describe, expect, spyOn, test } from 'bun:test'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

const Register = defineSchema({
  firstName: Validator.string(3, 50).required(),
  lastName: Validator.string(3, 50).required(),
  email: Validator.text().required().email(),
  password: Validator.string(8, 40).required().confirmed(),
})

describe('the example from the task', () => {
  test('a valid registration passes', () => {
    const r = Validator.validate(
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: '12345678',
        passwordConfirmation: '12345678',
      },
      Register,
    )
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.errors).toEqual({})
      expect(r.data.firstName).toBe('Ada')
    }
  })

  test('errors are returned per field name', () => {
    const r = Validator.validate(
      {
        firstName: 'Al',
        lastName: '',
        email: 'nope',
        password: '1234567',
        passwordConfirmation: 'x',
      },
      Register,
    )
    expect(r.valid).toBe(false)
    expect(r.errors).toEqual({
      firstName: ['firstName must be at least 3 characters'],
      lastName: ['lastName is required'],
      email: ['email must be a valid email'],
      // same order as 1.x: format checks, enum, confirmed, then length / size limits
      password: ['password confirmation does not match', 'password must be at least 8 characters'],
    })
  })
})

describe('result shape (unchanged from 1.x)', () => {
  const S = defineSchema({ v: Validator.text().required() })

  test('valid: true carries data and an empty errors object', () => {
    const body = { v: 'x', extra: 1 }
    const r = Validator.validate(body, S)
    expect(r).toEqual({ valid: true, data: body, errors: {} })
    if (r.valid) expect(r.data).toBe(body) // same object, nothing stripped or copied
  })

  test('valid: false has errors and no data', () => {
    const r = Validator.validate({}, S)
    expect(r.valid).toBe(false)
    expect('data' in r).toBe(false)
  })

  test('only fields from the schema are validated', () => {
    expect(Validator.validate({ v: 'x', other: 123 }, S).valid).toBe(true)
  })

  test('data must be a plain object', () => {
    for (const bad of [null, undefined, 'x', 1, [], [1]]) {
      expect(() => Validator.validate(bad as never, S)).toThrow(
        'Validation data must be a plain object',
      )
    }
  })
})

describe('schema reuse and caching', () => {
  test('the same schema validates many different bodies independently', () => {
    const results = ['a@b.co', 'bad', 'c@d.co', ''].map(
      (email) =>
        Validator.validate({ email }, defineSchema({ email: Validator.text().required().email() }))
          .valid,
    )
    expect(results).toEqual([true, false, true, false])

    const S = defineSchema({ email: Validator.text().required().email() })
    const again = ['a@b.co', 'bad', 'c@d.co', ''].map(
      (email) => Validator.validate({ email }, S).valid,
    )
    expect(again).toEqual([true, false, true, false])
  })

  test('a schema is compiled once and reused', () => {
    const S = defineSchema({ v: Validator.text().required() })
    const entries = spyOn(Object, 'entries')

    // restored in `finally`: a failing expect must not leave Object.entries spied on
    try {
      Validator.validate({ v: 'a' }, S)
      const afterFirst = entries.mock.calls.length
      expect(afterFirst).toBeGreaterThan(0)

      for (let i = 0; i < 50; i++) Validator.validate({ v: 'a' }, S)
      expect(entries.mock.calls.length).toBe(afterFirst)
    } finally {
      entries.mockRestore()
    }
  })

  test('the same field builders can be shared between schemas', () => {
    const email = Validator.text().required().email()
    const A = defineSchema({ email })
    const B = defineSchema({ email, backupEmail: Validator.text().nullable().email() })

    expect(Validator.validate({ email: 'a@b.co' }, A).valid).toBe(true)
    expect(Validator.validate({ email: 'a@b.co', backupEmail: 'x' }, B).valid).toBe(false)
  })

  test('schemas can be composed with spread', () => {
    const Base = { email: Validator.text().required().email() }
    const Extended = defineSchema({ ...Base, name: Validator.string(1, 10).required() })
    expect(Validator.validate({ email: 'a@b.co', name: 'x' }, Extended).valid).toBe(true)
    expect(Validator.validate({ email: 'a@b.co' }, Extended).errors).toEqual({
      name: ['name is required'],
    })
  })
})

describe('invalid schemas fail loudly', () => {
  test('1.x array rules are rejected with a helpful message', () => {
    const legacy = { v: ['required', 'string'] }
    expect(() => Validator.validate({}, legacy as never)).toThrow(
      /Array \/ string rules were removed in VentJS/,
    )
  })

  test('non-builder values and non-object schemas are rejected', () => {
    expect(() => Validator.validate({}, { v: 'required' } as never)).toThrow(TypeError)
    expect(() => Validator.validate({}, { v: null } as never)).toThrow(TypeError)
    expect(() => Validator.validate({}, null as never)).toThrow(TypeError)
  })
})

describe('Validation Schema Errors', () => {
  test('throws when a field has invalid validation rules', () => {
    const bad = Validator.text().required() as unknown as {
      nullable: () => never
    }

    const schema = {
      broken: bad.nullable(),
    }

    const consoleError = spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => Validator.validate({}, schema as never)).toThrow(
        '[VentJS] Invalid rules for field "broken".',
      )

      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
