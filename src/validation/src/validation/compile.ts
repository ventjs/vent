import type { ErrorMessages } from '../errors/errors-messages'
import { parseDate } from './date'
import { FieldBuilder } from './field-builder'
import type { FieldDef } from './field-builder'
import type { ValidationSchema } from './types'
import { checkUrl } from './url'

export type Data = Readonly<Record<string, unknown>>

/** Returns an error message, or `undefined` when the value passes. */
type Check = (value: unknown, data: Data) => string | undefined

/**
 * A field turned into plain data + closures. Messages are built once here,
 * so running a validation does no parsing and no string assembly for passing values.
 */
export interface FieldPlan {
  /** full path, used in messages and as the key in `errors`: "address.city" */
  readonly field: string
  /** the name inside the object being validated: "city" */
  readonly key: string
  readonly required: boolean
  readonly nullable: boolean
  readonly isType: ((value: unknown) => boolean) | undefined
  readonly typeMessage: string
  /** text kinds: `trim` / `lowercase`, applied before the checks */
  readonly transform: ((value: string) => string) | undefined
  /** `date` kind: validates the value and converts it to a `Date` (`undefined` = invalid) */
  readonly toDate: ((value: unknown) => Date | undefined) | undefined
  /** `object` kind: the plans of the nested fields (paths already prefixed) */
  readonly nested: readonly FieldPlan[] | undefined
  readonly checks: readonly Check[]
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function typeCheck(kind: FieldDef['kind']): {
  isType: ((value: unknown) => boolean) | undefined
  article: string
} {
  switch (kind) {
    case 'string':
    case 'text':
      return { isType: (v) => typeof v === 'string', article: 'a string' }
    case 'number':
      return { isType: (v) => typeof v === 'number' && Number.isFinite(v), article: 'a number' }
    case 'boolean':
      return { isType: (v) => typeof v === 'boolean', article: 'a boolean' }
    case 'array':
      return { isType: (v) => Array.isArray(v), article: 'an array' }
    case 'enum':
      return { isType: undefined, article: '' }
    // `date` and `object` are checked by the validator itself (conversion / recursion)
    case 'date':
      return { isType: undefined, article: 'a valid date' }
    case 'object':
      return { isType: undefined, article: 'an object' }
  }
}

function buildTransform(def: FieldDef): ((value: string) => string) | undefined {
  // fixed order, whatever the order of the calls: trim first, then lowercase
  if (def.trim && def.lowercase) return (v) => v.trim().toLowerCase()
  if (def.trim) return (v) => v.trim()
  if (def.lowercase) return (v) => v.toLowerCase()

  return undefined
}

function buildChecks(
  field: string,
  key: string,
  def: FieldDef,
  transform: ((value: string) => string) | undefined,
): Check[] {
  const checks: Check[] = []
  const { limits } = def

  if (def.email) {
    checks.push((v) =>
      typeof v === 'string' && EMAIL_PATTERN.test(v) ? undefined : `${field} must be a valid email`,
    )
  }

  if (def.url) {
    checks.push((v) => {
      const result = checkUrl(v as string)
      if (result === 'invalid') return `${field} must be a valid URL`
      if (result === 'protocol') return `${field} URL must use http or https`
      return undefined
    })
  }

  if (def.options !== undefined) {
    const allowed = new Set(def.options)
    const message = `${field} must be one of: ${def.options.join(', ')}`

    // strict, case-sensitive comparison; no coercion to string
    checks.push((v) => (typeof v === 'string' && allowed.has(v) ? undefined : message))
  }

  if (def.confirmed) {
    // looked up next to the field, so it also works inside a nested object:
    // address.password -> address.passwordConfirmation
    const confirmationKey = `${key}Confirmation`

    checks.push((v, data) => {
      const other = data[confirmationKey]
      // the value being checked has already been transformed, so the confirmation must be too
      const normalized = transform !== undefined && typeof other === 'string' ? transform(other) : other

      return v === normalized ? undefined : `${field} confirmation does not match`
    })
  }

  // numbers
  if (limits.min !== undefined) {
    const limit = limits.min
    checks.push((v) => ((v as number) < limit ? `${field} must be at least ${limit}` : undefined))
  }

  if (limits.max !== undefined) {
    const limit = limits.max
    checks.push((v) =>
      (v as number) > limit ? `${field} may not be greater than ${limit}` : undefined,
    )
  }

  // text length
  if (limits.minLength !== undefined) {
    const limit = limits.minLength
    checks.push((v) =>
      (v as string).length < limit ? `${field} must be at least ${limit} characters` : undefined,
    )
  }

  if (limits.maxLength !== undefined) {
    const limit = limits.maxLength
    checks.push((v) =>
      (v as string).length > limit ? `${field} may not exceed ${limit} characters` : undefined,
    )
  }

  // array size
  if (limits.minItems !== undefined) {
    const limit = limits.minItems
    checks.push((v) =>
      (v as unknown[]).length < limit ? `${field} must contain at least ${limit} items` : undefined,
    )
  }

  if (limits.maxItems !== undefined) {
    const limit = limits.maxItems
    checks.push((v) =>
      (v as unknown[]).length > limit
        ? `${field} may not contain more than ${limit} items`
        : undefined,
    )
  }

  return checks
}

/**
 * Turns a schema of builders into execution plans.
 * Runs once per schema object (the result is cached by `Validator`).
 * Nested `object()` shapes are compiled here too, so nothing is built while validating.
 */
export function compileSchema(
  schema: ValidationSchema,
  errorMessages: ErrorMessages,
): FieldPlan[] {
  return compileFields(schema, '', errorMessages)
}

function compileFields(
  schema: ValidationSchema,
  prefix: string,
  errorMessages: ErrorMessages,
): FieldPlan[] {
  const plans: FieldPlan[] = []

  for (const [key, builder] of Object.entries(schema)) {
    const field = prefix + key

    if (!(builder instanceof FieldBuilder)) {
      throw new TypeError(
        `Invalid validation rules for "${field}": expected a validator such as ` +
          `Validator.string(3, 50).required(). Array / string rules were removed in VentJS`,
      )
    }

    const def = builder.definition

    if (def.required && def.nullable) {
      console.error(errorMessages.invalidValidationSchema(field))

      throw new TypeError(`[VentJS] Invalid rules for field "${field}".`)
    }

    const { isType, article } = typeCheck(def.kind)
    const transform = buildTransform(def)

    plans.push({
      field,
      key,
      required: def.required,
      nullable: def.nullable,
      isType,
      typeMessage: `${field} must be ${article}`,
      transform,
      toDate: def.kind === 'date' ? parseDate : undefined,
      nested:
        def.kind === 'object' && def.shape !== undefined
          ? compileFields(def.shape, `${field}.`, errorMessages)
          : undefined,
      checks: buildChecks(field, key, def, transform),
    })
  }

  return plans
}
