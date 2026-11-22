import { describe, expect, test } from 'bun:test'
import { FieldBuilder } from '../src/validation/field-builder'
import { Validator } from '../src/validation/validator'
import { defineSchema } from '../src/validation/schema'

// Runtime guards exist for plain-JS callers; the types already hide these calls.
type Loose = Record<string, (...args: unknown[]) => unknown>
const loose = (b: unknown): Loose => b as Loose

describe('method chaining', () => {
  test('rules can be chained in any order', () => {
    const a = defineSchema({ email: Validator.text().required().email().maxLength(20) })
    const b = defineSchema({ email: Validator.text().maxLength(20).email().required() })

    for (const value of ['a@b.co', 'not-an-email', 'a'.repeat(30) + '@b.co', '']) {
      expect(Validator.validate({ email: value }, a)).toEqual(
        Validator.validate({ email: value }, b),
      )
    }
  })

  test('constructor limits and chained limits are equivalent', () => {
    const ctor = defineSchema({ v: Validator.string(3, 5).required() })
    const chained = defineSchema({ v: Validator.text().minLength(3).maxLength(5).required() })

    for (const value of ['', 'ab', 'abc', 'abcde', 'abcdef', 7, null]) {
      expect(Validator.validate({ v: value }, ctor)).toEqual(
        Validator.validate({ v: value }, chained),
      )
    }

    const n1 = defineSchema({ n: Validator.number(1, 5).required() })
    const n2 = defineSchema({ n: Validator.number().min(1).max(5).required() })
    const a1 = defineSchema({ a: Validator.array(1, 2).required() })
    const a2 = defineSchema({ a: Validator.array().minItems(1).maxItems(2).required() })

    for (const value of [0, 1, 5, 6, '3']) {
      expect(Validator.validate({ n: value }, n1)).toEqual(Validator.validate({ n: value }, n2))
    }
    for (const value of [[], [1], [1, 2], [1, 2, 3], 'x']) {
      expect(Validator.validate({ a: value }, a1)).toEqual(Validator.validate({ a: value }, a2))
    }
  })

  test('constructor limits cannot be overridden by a second, conflicting call', () => {
    expect(() => loose(Validator.string(3, 50)).minLength!(5)).toThrow(/already defined/)
    expect(() => loose(Validator.string(3, 50)).maxLength!(5)).toThrow(/already defined/)
    expect(() => loose(Validator.number(1, 5)).min!(2)).toThrow(/already defined/)
    expect(() => loose(Validator.array(1, 5)).maxItems!(2)).toThrow(/already defined/)
  })
})

describe('immutability and reuse', () => {
  test('every method returns a new builder and leaves the original untouched', () => {
    const base = Validator.text()
    const required = base.required()
    const nullable = base.nullable()

    expect(required).not.toBe(base)
    expect(nullable).not.toBe(base)

    const S = defineSchema({ a: required, b: nullable })
    expect(Validator.validate({}, S).errors).toEqual({ a: ['a is required'] })

    const baseDef = (base as unknown as FieldBuilder).definition
    expect(baseDef.required).toBe(false)
    expect(baseDef.nullable).toBe(false)
  })

  test('one partial builder can feed several fields', () => {
    const shortText = Validator.text().maxLength(5)
    const S = defineSchema({ first: shortText.required(), second: shortText.nullable() })

    expect(Validator.validate({ first: 'abcdef', second: 'abcdef' }, S).errors).toEqual({
      first: ['first may not exceed 5 characters'],
      second: ['second may not exceed 5 characters'],
    })
    expect(Validator.validate({ first: 'ok' }, S).valid).toBe(true)
  })

  test('builders are frozen', () => {
    expect(Object.isFrozen(Validator.text())).toBe(true)
  })
})

describe('runtime guards (plain JS callers)', () => {
  test('a rule not available for the kind throws', () => {
    expect(() => loose(Validator.boolean()).minLength!(1)).toThrow(/not available on a "boolean"/)
    expect(() => loose(Validator.number()).email!()).toThrow(/not available on a "number"/)
    expect(() => loose(Validator.array()).min!(1)).toThrow(/not available on a "array"/)
    expect(() => loose(Validator.enum(['a'])).url!()).toThrow(/not available on a "enum"/)
    expect(() => loose(Validator.number()).confirmed!()).toThrow(TypeError)
    expect(() => loose(Validator.date()).minLength!(1)).toThrow(/not available on a "date"/)
    expect(() => loose(Validator.date()).min!(1)).toThrow(/not available on a "date"/)
    expect(() => loose(Validator.object({})).email!()).toThrow(/not available on a "object"/)
    expect(() => loose(Validator.object({})).minItems!(1)).toThrow(/not available on a "object"/)
  })

  test('a rule applied twice throws', () => {
    expect(() => loose(Validator.text().email()).email!()).toThrow(/already defined/)
    expect(() => loose(Validator.text().required()).required!()).toThrow(/already defined/)
    expect(() => loose(Validator.text().nullable()).nullable!()).toThrow(/already defined/)
    expect(() => loose(Validator.text().confirmed()).confirmed!()).toThrow(/already defined/)
  })

  test('email and url cannot be combined', () => {
    expect(() => loose(Validator.text().email()).url!()).toThrow(/cannot be combined/)
    expect(() => loose(Validator.text().url()).email!()).toThrow(/cannot be combined/)
  })

  test('limits must be sane', () => {
    expect(() => Validator.text().minLength(-1)).toThrow(TypeError)
    expect(() => Validator.text().minLength(1.5)).toThrow(TypeError)
    expect(() => Validator.text().maxLength(Number.NaN)).toThrow(TypeError)
    expect(() => Validator.array().minItems(2.5)).toThrow(TypeError)
    expect(() => Validator.number().min(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => loose(Validator.text()).minLength!('3')).toThrow(TypeError)
  })

  test('a lower limit above the upper one is rejected, whichever is set first', () => {
    expect(() => Validator.string(10, 3)).toThrow(RangeError)
    expect(() => Validator.number(10, 3)).toThrow(RangeError)
    expect(() => Validator.array(10, 3)).toThrow(RangeError)
    expect(() => Validator.text().minLength(10).maxLength(3)).toThrow(RangeError)
    expect(() => Validator.text().maxLength(3).minLength(10)).toThrow(RangeError)
    expect(() => Validator.string(5, 5)).not.toThrow()
  })

  test('number() and array() take no arguments or both', () => {
    expect(() => loose(Validator).number!(1)).toThrow(TypeError)
    expect(() => loose(Validator).array!(1)).toThrow(TypeError)
  })
})
