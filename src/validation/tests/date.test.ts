import { describe, expect, test } from 'bun:test'
import { parseDate } from '../src/validation/date'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'

const S = defineSchema({ d: Validator.date().required() })

function dateOf(value: unknown): Date {
  const r = Validator.validate({ d: value }, S)
  if (!r.valid) throw new Error(`expected ${String(value)} to be valid: ${JSON.stringify(r.errors)}`)

  return r.data.d
}

describe('date(): valid strings (ISO 8601)', () => {
  test('a calendar date is read as midnight UTC', () => {
    expect(dateOf('2026-01-31').toISOString()).toBe('2026-01-31T00:00:00.000Z')
  })

  test('a date-time in UTC', () => {
    expect(dateOf('2026-01-31T10:30:45Z').toISOString()).toBe('2026-01-31T10:30:45.000Z')
    expect(dateOf('2026-01-31T10:30Z').toISOString()).toBe('2026-01-31T10:30:00.000Z')
  })

  test('an explicit offset is applied', () => {
    expect(dateOf('2026-01-31T10:00:00+03:00').toISOString()).toBe('2026-01-31T07:00:00.000Z')
    expect(dateOf('2026-01-31T10:00:00-05:30').toISOString()).toBe('2026-01-31T15:30:00.000Z')
    expect(dateOf('2026-01-31T00:30:00+01:00').toISOString()).toBe('2026-01-30T23:30:00.000Z')
    expect(dateOf('2026-01-31T10:00:00+00:00').toISOString()).toBe('2026-01-31T10:00:00.000Z')
  })

  test('fractional seconds keep millisecond precision', () => {
    expect(dateOf('2026-01-31T10:00:00.5Z').getUTCMilliseconds()).toBe(500)
    expect(dateOf('2026-01-31T10:00:00.123Z').getUTCMilliseconds()).toBe(123)
    expect(dateOf('2026-01-31T10:00:00.123456789Z').getUTCMilliseconds()).toBe(123)
  })

  test('leap days follow the real calendar', () => {
    expect(dateOf('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z')
    expect(dateOf('2000-02-29').toISOString()).toBe('2000-02-29T00:00:00.000Z')
    expect(Validator.validate({ d: '2025-02-29' }, S).valid).toBe(false)
    expect(Validator.validate({ d: '1900-02-29' }, S).valid).toBe(false)
  })

  test('the first and last days of every month are valid, the day after is not', () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // 2026 is not a leap year

    lengths.forEach((days, i) => {
      const month = String(i + 1).padStart(2, '0')
      expect(Validator.validate({ d: `2026-${month}-01` }, S).valid).toBe(true)
      expect(Validator.validate({ d: `2026-${month}-${String(days).padStart(2, '0')}` }, S).valid).toBe(true)
      expect(Validator.validate({ d: `2026-${month}-${String(days + 1).padStart(2, '0')}` }, S).valid).toBe(false)
    })
  })

  test('years below 100 are not mapped to 19xx', () => {
    expect(dateOf('0099-01-01').getUTCFullYear()).toBe(99)
    expect(dateOf('0001-01-01').getUTCFullYear()).toBe(1)
  })
})

describe('date(): Date instances', () => {
  test('a valid Date is accepted and returned as the very same instance', () => {
    const when = new Date('2026-01-31T10:00:00Z')
    const body = { d: when }
    const r = Validator.validate(body, S)

    if (!r.valid) throw new Error('expected a valid result')
    expect(r.data.d).toBe(when)
    expect(r.data).toBe(body) // nothing changed, so nothing was copied
  })

  test('an Invalid Date is rejected', () => {
    expect(Validator.validate({ d: new Date('nonsense') }, S).errors).toEqual({
      d: ['d must be a valid date'],
    })
    expect(Validator.validate({ d: new Date(Number.NaN) }, S).valid).toBe(false)
  })

  test('a JSON round trip produces a string that is accepted again as the same instant', () => {
    const original = new Date('2026-06-15T08:45:10.250Z')
    const body = JSON.parse(JSON.stringify({ d: original })) as Record<string, unknown>

    expect(typeof body.d).toBe('string')
    expect(dateOf(body.d).getTime()).toBe(original.getTime())
  })
})

describe('date(): values that are not valid dates', () => {
  const invalidStrings = [
    'nonsense',
    '2026-02-30', // impossible day (engines like to roll it over to March)
    '2026-02-31',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z',
    '2026-01-01T23:59:60Z',
    '2026-01-01T10:00:00+24:00',
    '2026-01-01T10:00:00+03:60',
    '2026-01-01T10:00:00', // no offset: would depend on the server's time zone
    '2026-01-01T10:00',
    '2026-01-01T10:00:00+0300', // offset needs the colon
    '2026-01-01T10:00:00+03',
    '2026-01-01t10:00:00Z', // ISO uses an upper-case T and Z
    '2026-01-01T10:00:00z',
    '2026-01-01 10:00:00Z', // space instead of T
    '2026-1-1',
    '26-01-01',
    '2026/01/01',
    '01/31/2026',
    'Jan 31, 2026',
    'Sat Jan 31 2026',
    '2026-01-01T10:00:00.Z',
    '2026-01-01T10:00:00.1234567890Z',
    '+002026-01-01',
    '2026-01-01Z',
    '1',
    '2026',
    '2026-01',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01\n',
  ]

  for (const value of invalidStrings) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      expect(Validator.validate({ d: value }, S).errors).toEqual({ d: ['d must be a valid date'] })
    })
  }

  const unsupportedTypes: [string, unknown][] = [
    ['a timestamp number', 1769853600000],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['a boolean', true],
    ['an object', { year: 2026 }],
    ['an array', ['2026-01-31']],
    ['a function', () => new Date()],
    ['an empty object', {}],
  ]

  for (const [label, value] of unsupportedTypes) {
    test(`rejects ${label}`, () => {
      expect(Validator.validate({ d: value }, S).errors).toEqual({ d: ['d must be a valid date'] })
    })
  }

  test('a rejected value yields no data', () => {
    expect('data' in Validator.validate({ d: 'nonsense' }, S)).toBe(false)
  })
})

describe('date(): required / nullable', () => {
  const Req = defineSchema({ d: Validator.date().required() })
  const Nul = defineSchema({ d: Validator.date().nullable() })

  test('required rejects undefined, null, empty and whitespace-only strings', () => {
    for (const body of [{}, { d: undefined }, { d: null }, { d: '' }, { d: '   ' }]) {
      expect(Validator.validate(body, Req).errors).toEqual({ d: ['d is required'] })
    }
  })

  test('nullable accepts undefined, null and blank strings', () => {
    for (const body of [{}, { d: undefined }, { d: null }, { d: '' }, { d: ' ' }]) {
      expect(Validator.validate(body, Nul).valid).toBe(true)
    }
  })

  test('nullable still checks a value that is present', () => {
    expect(Validator.validate({ d: '2026-01-31' }, Nul).valid).toBe(true)
    expect(Validator.validate({ d: 'nonsense' }, Nul).errors).toEqual({ d: ['d must be a valid date'] })
    expect(Validator.validate({ d: 5 }, Nul).valid).toBe(false)
  })

  test('nullable null stays null, an absent key stays absent', () => {
    const withNull = Validator.validate({ d: null }, Nul)
    const absent = Validator.validate({}, Nul)

    if (!withNull.valid || !absent.valid) throw new Error('expected valid results')
    expect(withNull.data.d).toBeNull()
    expect('d' in absent.data).toBe(false)
  })
})

describe('date(): the value in `data`', () => {
  const Event = defineSchema({
    title: Validator.string(3, 100).required(),
    startDate: Validator.date().required(),
    endDate: Validator.date().nullable(),
  })

  test('strings become Date objects, the input is left alone', () => {
    const body = { title: 'Launch', startDate: '2026-03-01T09:00:00Z', endDate: null, extra: true }
    const r = Validator.validate(body, Event)

    if (!r.valid) throw new Error('expected a valid result')
    expect(r.data.startDate).toBeInstanceOf(Date)
    expect(r.data.startDate.toISOString()).toBe('2026-03-01T09:00:00.000Z')
    expect(r.data.endDate).toBeNull()
    // keys outside the schema are carried over (they are not part of the inferred type)
    expect({ ...r.data }).toMatchObject({ extra: true })

    expect(body.startDate).toBe('2026-03-01T09:00:00Z') // not mutated
    expect(r.data).not.toBe(body)
  })

  test('a Date already in the input stays the same instance next to a converted one', () => {
    const end = new Date('2026-03-02T09:00:00Z')
    const r = Validator.validate({ title: 'Launch', startDate: '2026-03-01', endDate: end }, Event)

    if (!r.valid) throw new Error('expected a valid result')
    expect(r.data.endDate).toBe(end)
  })

  test('all invalid dates of a schema are reported together', () => {
    const r = Validator.validate({ title: 'Launch', startDate: 'x', endDate: 12 }, Event)

    expect(r.errors).toEqual({
      startDate: ['startDate must be a valid date'],
      endDate: ['endDate must be a valid date'],
    })
  })

  test('dates work inside nested objects, with the full path in the error', () => {
    const Nested = defineSchema({
      event: Validator.object({ when: Validator.date().required() }).required(),
    })

    const ok = Validator.validate({ event: { when: '2026-01-31' } }, Nested)
    if (!ok.valid) throw new Error('expected a valid result')
    expect(ok.data.event.when).toBeInstanceOf(Date)

    expect(Validator.validate({ event: { when: '2026-02-30' } }, Nested).errors).toEqual({
      'event.when': ['event.when must be a valid date'],
    })
  })
})

describe('date(): building', () => {
  test('rules of other kinds do not exist (runtime guard for plain JS)', () => {
    const loose = Validator.date() as unknown as Record<string, (...a: unknown[]) => unknown>

    expect(() => loose.min!(1)).toThrow(/not available on a "date"/)
    expect(() => loose.minLength!(1)).toThrow(/not available on a "date"/)
    expect(() => loose.email!()).toThrow(/not available on a "date"/)
    expect(() => loose.confirmed!()).toThrow(/not available on a "date"/)
  })

  test('is immutable and can be shared', () => {
    const base = Validator.date()
    const S2 = defineSchema({ a: base.required(), b: base.nullable() })

    expect(Object.isFrozen(base)).toBe(true)
    expect(Validator.validate({}, S2).errors).toEqual({ a: ['a is required'] })
  })
})

describe('parseDate() directly', () => {
  test('returns undefined for anything invalid and never throws', () => {
    for (const value of [undefined, null, '', 'x', 1, {}, [], Symbol('s'), 1n, new Date(Number.NaN)]) {
      expect(parseDate(value)).toBeUndefined()
    }
  })
})
