import { ErrorMessages } from '../errors/errors-messages'
import { compileSchema } from './compile'
import type { Data, FieldPlan } from './compile'
import { FieldBuilder, present, validateEnumOptions } from './field-builder'
import type {
  Checked,
  Fresh,
  InferSchema,
  ValidationErrors,
  ValidationResult,
  ValidationSchema,
} from './types'

export class Validator {
  private static errorMessages = new ErrorMessages()

  static configure(errorMessages: ErrorMessages): void {
    this.errorMessages = errorMessages
  }

  // Validator factories

  /** Text with a length range: `Validator.string(minLength, maxLength)`. */
  static string(
    minLength: number,
    maxLength: number,
  ): Fresh<'string', string, 'minLength' | 'maxLength'> {
    return present(FieldBuilder.create('string').minLength(minLength).maxLength(maxLength))
  }

  /** Text with no default length limits. Add `.minLength()` / `.maxLength()` if needed. */
  static text(): Fresh<'text', string> {
    return present(FieldBuilder.create('text'))
  }

  /** A finite number, optionally with a range: `Validator.number(min, max)`. */
  static number(): Fresh<'number', number>
  static number(min: number, max: number): Fresh<'number', number, 'min' | 'max'>
  static number(min?: number, max?: number): Fresh<'number', number, 'min' | 'max'> {
    const base = FieldBuilder.create('number')

    if (arguments.length === 0) return present(base)
    if (arguments.length === 1) {
      throw new TypeError('Validator.number() takes either no arguments or both (min, max)')
    }

    return present(base.min(min as number).max(max as number))
  }

  static boolean(): Fresh<'boolean', boolean> {
    return present(FieldBuilder.create('boolean'))
  }

  /** An array, optionally with a size range: `Validator.array(minItems, maxItems)`. */
  static array(): Fresh<'array', unknown[]>
  static array(
    minItems: number,
    maxItems: number,
  ): Fresh<'array', unknown[], 'minItems' | 'maxItems'>
  static array(
    minItems?: number,
    maxItems?: number,
  ): Fresh<'array', unknown[], 'minItems' | 'maxItems'> {
    const base = FieldBuilder.create('array')

    if (arguments.length === 0) return present(base)
    if (arguments.length === 1) {
      throw new TypeError(
        'Validator.array() takes either no arguments or both (minItems, maxItems)',
      )
    }

    return present(base.minItems(minItems as number).maxItems(maxItems as number))
  }

  /** One of a fixed list of strings. The type is the union of the given literals. */
  static enum<const T extends readonly [string, ...string[]]>(
    options: T,
  ): Fresh<'enum', T[number]> {
    validateEnumOptions(options)

    return present(FieldBuilder.create('enum', [...options]))
  }

  /**
   * A date. Accepts a valid `Date` or an ISO 8601 string (JSON cannot carry a `Date`):
   * `2026-01-31`, `2026-01-31T10:00:00Z`, `2026-01-31T10:00:00+03:00`.
   * The value in `data` is always a `Date`. Numbers and other formats are rejected.
   */
  static date(): Fresh<'date', Date> {
    return present(FieldBuilder.create('date'))
  }

  /**
   * A nested object, described with the same fluent validators:
   *
   *   address: Validator.object({ city: Validator.string(2, 100).required() }).required()
   *
   * Errors of nested fields are reported under their full path: `address.city`.
   */
  static object<S extends ValidationSchema>(
    shape: S & Checked<S>,
  ): Fresh<'object', InferSchema<S>> {
    return present(FieldBuilder.createObject(shape))
  }

  // Validation

  // Compiled schemas, keyed by the schema object itself (weak: no memory leak).
  private static planCache = new WeakMap<object, readonly FieldPlan[]>()

  private static getPlans(schema: ValidationSchema): readonly FieldPlan[] {
    if (typeof schema !== 'object' || schema === null) {
      throw new TypeError('Validation schema must be an object')
    }

    const cached = this.planCache.get(schema)
    if (cached !== undefined) return cached

    const plans = compileSchema(schema, this.errorMessages)
    this.planCache.set(schema, plans)

    return plans
  }

  static validate<S extends ValidationSchema>(
    data: Record<string, unknown>,
    schema: S & Checked<S>,
  ): ValidationResult<InferSchema<S>> {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Validation data must be a plain object')
    }

    const plans = this.getPlans(schema)
    const errors: ValidationErrors = {}
    const result = runPlans(plans, data, errors)

    if (hasErrors(errors)) {
      return { valid: false, errors }
    }

    // The data has just been checked (and normalized) against exactly the rules
    // `InferSchema<S>` was derived from, so presenting it under that type is sound.
    // This is the only cast on the data path.
    return { valid: true, data: result as InferSchema<S>, errors: {} }
  }
}

function hasErrors(errors: ValidationErrors): boolean {
  for (const _ in errors) return true

  return false
}

function isPlainObject(value: unknown): value is Data {
  if (typeof value !== 'object' || value === null) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Runs the plans of one object (the root data, or a nested `object()` value) and writes the
 * errors of every field into `errors` under its full path.
 *
 * Returns the data to hand back: the very same object when no value had to change, otherwise
 * a shallow copy holding the transformed values (`trim()`, `lowercase()`, `date()`, nested
 * changes). The input is never mutated, and nothing is allocated for data that is already clean.
 */
function runPlans(plans: readonly FieldPlan[], data: Data, errors: ValidationErrors): Data {
  let out: Record<string, unknown> | undefined

  for (const plan of plans) {
    const { field, key } = plan
    const value = data[key]

    const blank = typeof value === 'string' && value.trim() === ''

    if (plan.required && (value === undefined || value === null || blank)) {
      ;(errors[field] ??= []).push(`${field} is required`)
      continue
    }

    if (value === undefined) continue
    if (value === null && plan.nullable) continue

    if (blank && !plan.required) {
      // A blank string counts as "not provided", but a text field still gets its
      // transformations: with trim(), '   ' is returned as ''.
      if (plan.transform !== undefined && typeof value === 'string') {
        const normalized = plan.transform(value)
        if (normalized !== value) (out ??= { ...data })[key] = normalized
      }

      continue
    }

    let next: unknown = value

    if (plan.nested !== undefined) {
      if (!isPlainObject(value)) {
        ;(errors[field] ??= []).push(plan.typeMessage)
        continue
      }

      next = runPlans(plan.nested, value, errors)
    } else if (plan.toDate !== undefined) {
      next = plan.toDate(value)

      if (next === undefined) {
        ;(errors[field] ??= []).push(plan.typeMessage)
        continue
      }
    } else {
      if (plan.isType !== undefined && !plan.isType(value)) {
        ;(errors[field] ??= []).push(plan.typeMessage)
        continue
      }

      // transformations run before the checks: ' ZEN@EXAMPLE.COM ' is checked as 'zen@example.com'
      if (plan.transform !== undefined && typeof value === 'string') {
        next = plan.transform(value)
      }
    }

    for (const check of plan.checks) {
      const message = check(next, data)

      if (message !== undefined) {
        ;(errors[field] ??= []).push(message)
      }
    }

    if (next !== value) (out ??= { ...data })[key] = next
  }

  return out ?? data
}
