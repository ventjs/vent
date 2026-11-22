import type { Checked, ValidationSchema } from './types'

/**
 * Declares a schema. Returns it untouched (no runtime cost); its job is the compile-time
 * check, which knows each field's NAME:
 *
 *  - every field must have chosen `.required()` or `.nullable()`
 *  - `.confirmed()` is accepted on `password` only
 *  - `.email()` is accepted on fields whose name contains "email"
 */
export function defineSchema<S extends ValidationSchema>(schema: S & Checked<S>): S {
  return schema
}
