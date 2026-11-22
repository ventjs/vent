// Compile-time tests. `bun test` only runs the (trivial) runtime assertions here;
// the real checks are made by `tsc --noEmit`:
//   - `Expect<Equal<...>>` fails to compile when an inferred type is wrong
//   - `// @ts-expect-error` fails to compile when the line is NOT an error
// The probes live in functions that are never called, so they cost nothing at runtime.

import { describe, expect, test } from 'bun:test'
import { defineSchema } from '../src/validation/schema'
import { Validator } from '../src/validation/validator'
import type { InferSchema } from '../src/validation/types'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

const Product = defineSchema({
  name: Validator.string(3, 100).required(),
  description: Validator.text().nullable(),
  price: Validator.number(1, 10000).required(),
  stock: Validator.number(0, 100000).required(),
  isActive: Validator.boolean().required(),
  role: Validator.enum(['admin', 'user']).required(),
  tags: Validator.array(1, 10).required(),
  note: Validator.boolean().nullable(),
})

type ProductData = InferSchema<typeof Product>

export type InferenceCases = [
  Expect<
    Equal<
      ProductData,
      {
        name: string
        price: number
        stock: number
        isActive: boolean
        role: 'admin' | 'user'
        tags: unknown[]
        description?: string | null
        note?: boolean | null
      }
    >
  >,
]

export function inferenceProbe(body: Record<string, unknown>): void {
  const validation = Validator.validate(body, Product)

  // Discriminated union: `data` only exists after checking `valid`.
  // @ts-expect-error data is not accessible before narrowing
  void validation.data

  if (validation.valid) {
    const name: string = validation.data.name
    const description: string | null | undefined = validation.data.description
    const price: number = validation.data.price
    const role: 'admin' | 'user' = validation.data.role
    const tags: unknown[] = validation.data.tags
    void [name, description, price, role, tags]

    // @ts-expect-error 'moderator' is not part of the enum union
    const bad: typeof validation.data.role = 'moderator'
    void bad
  } else {
    const errors: Record<string, string[]> = validation.errors
    void errors
    // @ts-expect-error data does not exist when valid is false
    void validation.data
  }
}

export function enumProbe(): void {
  const literal = Validator.enum(['pending', 'active', 'disabled']).required()
  const S = defineSchema({ status: literal })
  type Status = InferSchema<typeof S>['status']
  const statusCase: Expect<Equal<Status, 'pending' | 'active' | 'disabled'>> = true
  void statusCase

  // @ts-expect-error an empty enum is not allowed
  Validator.enum([])
  // @ts-expect-error enum options must be strings
  Validator.enum([1, 2])
}

export function factoryProbe(): void {
  // @ts-expect-error string() requires both limits
  Validator.string()
  // @ts-expect-error string() requires both limits
  Validator.string(3)
  // @ts-expect-error number accepts none or both limits
  Validator.number(3)
  // @ts-expect-error array accepts none or both limits
  Validator.array(1)
  // @ts-expect-error limits must be numbers
  Validator.string('3', '50')
}

export function methodAvailabilityProbe(): void {
  // Boolean: no text / number / array rules, no confirmed
  const b = Validator.boolean()
  // @ts-expect-error
  b.minLength(1)
  // @ts-expect-error
  b.email()
  // @ts-expect-error
  b.min(1)
  // @ts-expect-error
  b.minItems(1)
  // @ts-expect-error
  b.confirmed()

  // Number: only min / max
  const n = Validator.number()
  // @ts-expect-error
  n.email()
  // @ts-expect-error
  n.minLength(1)
  // @ts-expect-error
  n.confirmed()
  n.min(1).max(2)

  // Array: only minItems / maxItems
  const a = Validator.array()
  // @ts-expect-error
  a.min(1)
  // @ts-expect-error
  a.email()
  a.minItems(1).maxItems(2)

  // Enum: no rules at all (only presence)
  const e = Validator.enum(['a', 'b'])
  // @ts-expect-error
  e.minLength(1)
  // @ts-expect-error
  e.email()
  e.required()

  // Text and string share the text rules
  Validator.text().minLength(1).maxLength(2).email().confirmed()
  Validator.string(1, 2).url()
}

export function noDuplicatesProbe(): void {
  // Limits already given in the constructor cannot be repeated
  // @ts-expect-error
  Validator.string(3, 50).minLength(5)
  // @ts-expect-error
  Validator.string(3, 50).maxLength(5)
  // @ts-expect-error
  Validator.number(1, 10).min(2)
  // @ts-expect-error
  Validator.array(1, 10).maxItems(2)

  // ...while chaining covers the same ground when the constructor is not used
  Validator.text().minLength(3).maxLength(50)

  // The same rule twice
  // @ts-expect-error
  Validator.text().minLength(1).minLength(2)
  // @ts-expect-error
  Validator.text().email().email()
  // @ts-expect-error
  Validator.text().required().required()

  // required and nullable exclude each other, in either order
  // @ts-expect-error
  Validator.text().required().nullable()
  // @ts-expect-error
  Validator.text().nullable().required()

  // email and url exclude each other
  // @ts-expect-error
  Validator.text().email().url()
  // @ts-expect-error
  Validator.text().url().email()
}

export function schemaKeyProbe(): void {
  // confirmed: password only
  defineSchema({ password: Validator.string(8, 40).required().confirmed() })
  defineSchema({
    // @ts-expect-error confirmed is not allowed on other fields
    username: Validator.string(3, 30).required().confirmed(),
  })

  // email: only on fields whose name contains "email"
  defineSchema({ email: Validator.text().required().email() })
  defineSchema({ contactEmail: Validator.text().nullable().email() })
  defineSchema({
    // @ts-expect-error email() is not allowed on a field named "username"
    username: Validator.text().required().email(),
  })

  // a field must settle required / nullable
  defineSchema({
    // @ts-expect-error missing .required() or .nullable()
    title: Validator.string(1, 10),
  })

  // The same checks apply when passing a schema inline to validate
  Validator.validate(
    {},
    {
      // @ts-expect-error confirmed is not allowed on "token"
      token: Validator.string(1, 10).required().confirmed(),
    },
  )

  // Old-style array rules are no longer accepted
  defineSchema({
    // @ts-expect-error string rules were removed in 2.0.0
    legacy: ['required', 'string', 'minLength:3'],
  })
}

// ---------------------------------------------------------------------------
// object() / date() / trim() / lowercase()
// ---------------------------------------------------------------------------

const Registration = defineSchema({
  name: Validator.string(3, 50).required(),
  bio: Validator.text().nullable(),
  age: Validator.number(18, 100).required(),
  isActive: Validator.boolean().required(),
  tags: Validator.array(1, 10).required(),
  role: Validator.enum(['admin', 'user']).required(),
  email: Validator.text().required().email().trim().lowercase(),
  birthDate: Validator.date().nullable(),
  address: Validator.object({
    city: Validator.string(2, 100).required(),
    country: Validator.string(2, 100).required(),
  }).required(),
})

export type RegistrationCases = [
  // the whole schema of the task, every kind at once
  Expect<
    Equal<
      InferSchema<typeof Registration>,
      {
        name: string
        age: number
        isActive: boolean
        tags: unknown[]
        role: 'admin' | 'user'
        email: string
        address: { city: string; country: string }
        bio?: string | null
        birthDate?: Date | null
      }
    >
  >,
]

const Nested = defineSchema({
  company: Validator.object({
    name: Validator.string(1, 80).required(),
    nickname: Validator.text().nullable(),
    founded: Validator.date().required(),
    headquarters: Validator.object({
      city: Validator.text().required(),
      geo: Validator.object({
        lat: Validator.number(-90, 90).required(),
        lng: Validator.number(-180, 180).required(),
      }).nullable(),
    }).required(),
    kind: Validator.enum(['llc', 'inc']).required(),
    tags: Validator.array().nullable(),
  }).required(),
  previous: Validator.object({ name: Validator.text().required() }).nullable(),
})

export type NestedCases = [
  Expect<
    Equal<
      InferSchema<typeof Nested>,
      {
        company: {
          name: string
          founded: Date
          headquarters: {
            city: string
            geo?: { lat: number; lng: number } | null
          }
          kind: 'llc' | 'inc'
          nickname?: string | null
          tags?: unknown[] | null
        }
        previous?: { name: string } | null
      }
    >
  >,
]

export type DateCases = [
  Expect<Equal<InferSchema<{ d: ReturnType<typeof dateRequired> }>['d'], Date>>,
  Expect<Equal<InferSchema<{ d: ReturnType<typeof dateNullable> }>['d'], Date | null | undefined>>,
]

function dateRequired() {
  return Validator.date().required()
}

function dateNullable() {
  return Validator.date().nullable()
}

export type TransformKeepsTheType = [
  // trim() / lowercase() change the VALUE, not its type
  Expect<
    Equal<
      InferSchema<{
        a: ReturnType<typeof trimmed>
        b: ReturnType<typeof trimmedNullable>
      }>,
      { a: string; b?: string | null }
    >
  >,
]

function trimmed() {
  return Validator.text().trim().lowercase().required()
}

function trimmedNullable() {
  return Validator.string(3, 50).trim().nullable()
}

export function textTransformProbe(): void {
  // allowed: string and text, alone or in any chain
  Validator.string(3, 50).trim().lowercase()
  Validator.text().trim().lowercase()
  Validator.text().required().email().trim().lowercase()
  Validator.text().lowercase().trim().required()
  Validator.string(3, 50).required().trim()

  // not allowed: every other kind
  // @ts-expect-error
  Validator.number(18, 100).trim()
  // @ts-expect-error
  Validator.number().lowercase()
  // @ts-expect-error
  Validator.boolean().trim()
  // @ts-expect-error
  Validator.boolean().lowercase()
  // @ts-expect-error
  Validator.array(1, 10).trim()
  // @ts-expect-error
  Validator.array().lowercase()
  // @ts-expect-error
  Validator.enum(['admin', 'user']).trim()
  // @ts-expect-error
  Validator.enum(['admin', 'user']).lowercase()
  // @ts-expect-error
  Validator.object({ city: Validator.text().required() }).trim()
  // @ts-expect-error
  Validator.object({ city: Validator.text().required() }).lowercase()
  // @ts-expect-error
  Validator.date().trim()
  // @ts-expect-error
  Validator.date().lowercase()

  // also after the presence has been chosen
  // @ts-expect-error
  Validator.number(1, 5).required().trim()
  // @ts-expect-error
  Validator.date().nullable().lowercase()

  // each one is applied once
  // @ts-expect-error
  Validator.text().trim().trim()
  // @ts-expect-error
  Validator.text().lowercase().lowercase()
  // @ts-expect-error
  Validator.text().trim().lowercase().trim()
}

export function dateProbe(): void {
  const d = Validator.date()
  // only presence exists on a date
  // @ts-expect-error
  d.min(1)
  // @ts-expect-error
  d.max(1)
  // @ts-expect-error
  d.minLength(1)
  // @ts-expect-error
  d.email()
  // @ts-expect-error
  d.url()
  // @ts-expect-error
  d.minItems(1)
  // @ts-expect-error
  d.confirmed()
  d.required()
  d.nullable()

  // required and nullable exclude each other
  // @ts-expect-error
  Validator.date().required().nullable()
  // @ts-expect-error
  Validator.date().nullable().required()
  // @ts-expect-error
  Validator.date().required().required()

  // a date field must settle its presence
  defineSchema({
    // @ts-expect-error missing .required() or .nullable()
    when: Validator.date(),
  })

  // no arguments
  // @ts-expect-error
  Validator.date('2026-01-01')
}

export function objectProbe(): void {
  const o = Validator.object({ city: Validator.text().required() })
  // only presence exists on an object
  // @ts-expect-error
  o.minLength(1)
  // @ts-expect-error
  o.min(1)
  // @ts-expect-error
  o.minItems(1)
  // @ts-expect-error
  o.email()
  o.required()
  o.nullable()

  // @ts-expect-error required and nullable exclude each other
  Validator.object({ city: Validator.text().required() }).required().nullable()

  // a shape is required, and it must be an object of validators
  // @ts-expect-error
  Validator.object()
  // @ts-expect-error
  Validator.object('city')
  // @ts-expect-error
  Validator.object(['city'])
  // @ts-expect-error
  Validator.object(null)
  Validator.object({
    // @ts-expect-error a plain value is not a validator
    city: 'text',
  })
  Validator.object({
    // @ts-expect-error old-style rules are not accepted here either
    city: ['required', 'string'],
  })

  // an object field must settle its presence
  defineSchema({
    // @ts-expect-error missing .required() or .nullable()
    address: Validator.object({ city: Validator.text().required() }),
  })

  // the fields inside follow the same rules as the top-level ones
  Validator.object({
    // @ts-expect-error missing .required() or .nullable()
    city: Validator.string(2, 100),
  })
  Validator.object({
    // @ts-expect-error confirmed is only allowed on "password"
    city: Validator.string(2, 100).required().confirmed(),
  })
  Validator.object({
    // @ts-expect-error email() needs a field whose name contains "email"
    city: Validator.text().required().email(),
  })
  Validator.object({
    inner: Validator.object({
      // @ts-expect-error a deeper level is checked too: missing .required() or .nullable()
      city: Validator.text(),
    }).required(),
  })

  // ...and the allowed ones are allowed
  Validator.object({ password: Validator.string(8, 40).required().confirmed() })
  Validator.object({ contactEmail: Validator.text().nullable().email().trim().lowercase() })

  // object() works inline in validate() as well
  Validator.validate(
    {},
    {
      address: Validator.object({
        // @ts-expect-error confirmed is not allowed on "token"
        token: Validator.string(1, 10).required().confirmed(),
      }).required(),
    },
  )
}

export function resultShapeProbe(body: Record<string, unknown>): void {
  const r = Validator.validate(body, Registration)

  if (r.valid) {
    // the inferred types are usable as they are
    const city: string = r.data.address.city
    const born: Date | null | undefined = r.data.birthDate
    const email: string = r.data.email
    void [city, born, email]

    // @ts-expect-error address has no "zip"
    void r.data.address.zip
    // @ts-expect-error a Date is not a string
    const bad: string = r.data.birthDate
    void bad
  } else {
    const errors: Record<string, string[]> = r.errors
    void errors
  }
}

// The way a VentJS controller uses the result. No `as` is needed anywhere: after
// `if (!validation.valid) throw`, TypeScript narrows `validation` to the valid branch and
// `validation.data` already has the type that the schema describes.
class UnprocessableEntityException extends Error {
  constructor(
    readonly body: { success: false; message: string; errors: Record<string, string[]> },
  ) {
    super(body.message)
  }
}

const RegisterAuthRule = defineSchema({
  firstName: Validator.string(3, 50).required(),
  lastName: Validator.string(3, 50).required(),
  email: Validator.text().required().email().trim().lowercase(),
  password: Validator.string(8, 40).required().confirmed(),
  birthDate: Validator.date().nullable(),
  address: Validator.object({ city: Validator.string(2, 100).required() }).nullable(),
})

// the body type can be derived from the schema instead of being written by hand
export type RegisterBody = InferSchema<typeof RegisterAuthRule>

export function controllerProbe(body: Record<string, unknown>): void {
  const validation = Validator.validate({ ...body }, RegisterAuthRule)

  if (!validation.valid) {
    throw new UnprocessableEntityException({
      success: false,
      message: 'validation failed',
      errors: validation.errors,
    })
  }

  const { firstName, lastName, email, password, birthDate, address } = validation.data

  const cases: [
    Expect<Equal<typeof firstName, string>>,
    Expect<Equal<typeof lastName, string>>,
    Expect<Equal<typeof email, string>>,
    Expect<Equal<typeof password, string>>,
    Expect<Equal<typeof birthDate, Date | null | undefined>>,
    Expect<Equal<typeof address, { city: string } | null | undefined>>,
  ] = [true, true, true, true, true, true]
  void cases

  // the derived type and the narrowed data are the same type
  const asBody: RegisterBody = validation.data
  void asBody
}

describe('compile-time design (verified by tsc --noEmit)', () => {
  test('the probes are never executed', () => {
    expect(typeof inferenceProbe).toBe('function')
    expect(typeof methodAvailabilityProbe).toBe('function')
    expect(typeof textTransformProbe).toBe('function')
    expect(typeof dateProbe).toBe('function')
    expect(typeof objectProbe).toBe('function')
    expect(typeof resultShapeProbe).toBe('function')
    expect(typeof controllerProbe).toBe('function')
  })
})
