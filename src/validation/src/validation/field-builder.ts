import type { Builder, Kind, RuleName, State, ValidationSchema } from './types'

type LimitName = 'min' | 'max' | 'minLength' | 'maxLength' | 'minItems' | 'maxItems'

/** Immutable, declarative description of one field. Nothing here runs a validation. */
export interface FieldDef {
  readonly kind: Kind
  readonly required: boolean
  readonly nullable: boolean
  readonly email: boolean
  readonly url: boolean
  readonly confirmed: boolean
  /** text transformations, applied (trim first, then lowercase) before any check */
  readonly trim: boolean
  readonly lowercase: boolean
  readonly limits: Readonly<Partial<Record<LimitName, number>>>
  readonly options: readonly string[] | undefined
  /** `object` kind only: the nested fields, frozen when the builder is created */
  readonly shape: ValidationSchema | undefined
}

const KIND_RULES: Readonly<Record<Kind, ReadonlySet<RuleName>>> = {
  string: new Set<RuleName>([
    'minLength',
    'maxLength',
    'email',
    'url',
    'confirmed',
    'trim',
    'lowercase',
  ]),
  text: new Set<RuleName>([
    'minLength',
    'maxLength',
    'email',
    'url',
    'confirmed',
    'trim',
    'lowercase',
  ]),
  number: new Set<RuleName>(['min', 'max']),
  boolean: new Set<RuleName>(),
  array: new Set<RuleName>(['minItems', 'maxItems']),
  enum: new Set<RuleName>(),
  date: new Set<RuleName>(),
  object: new Set<RuleName>(),
}

// Lower bound / upper bound pairs: the lower one may never exceed the upper one.
const LIMIT_PAIRS: readonly (readonly [LimitName, LimitName])[] = [
  ['min', 'max'],
  ['minLength', 'maxLength'],
  ['minItems', 'maxItems'],
]

function assertLimit(rule: LimitName, value: number, integerOnly: boolean): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Rule "${rule}" requires a finite number, received ${String(value)}`)
  }

  if (integerOnly) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`Rule "${rule}" requires a non-negative integer, received ${value}`)
    }
  }
}

/**
 * Runtime half of the fluent API. Every method returns a NEW builder, so a partially
 * built validator can be reused safely:
 *
 *   const base = Validator.text()
 *   const a = base.required()   // `base` is untouched
 *   const b = base.nullable()
 *
 * The compile-time half (which methods exist for which kind) lives in `types.ts`;
 * the guards below repeat those rules at runtime for plain-JS callers.
 */
export class FieldBuilder {
  readonly definition: FieldDef

  constructor(definition: FieldDef) {
    this.definition = definition
    Object.freeze(this)
  }

  static create(kind: Kind, options?: readonly string[]): FieldBuilder {
    return new FieldBuilder({
      kind,
      required: false,
      nullable: false,
      email: false,
      url: false,
      confirmed: false,
      trim: false,
      lowercase: false,
      limits: {},
      options,
      shape: undefined,
    })
  }

  /** `object` kind: the shape is copied and frozen, so changing the original afterwards is harmless. */
  static createObject(shape: ValidationSchema): FieldBuilder {
    if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) {
      throw new TypeError(
        'Validator.object() requires an object of validators, e.g. { city: Validator.text().required() }',
      )
    }

    return new FieldBuilder({
      ...FieldBuilder.create('object').definition,
      shape: Object.freeze({ ...shape }),
    })
  }

  // -- presence -------------------------------------------------------------
  // `required` + `nullable` together is detected when the schema is compiled

  required(): FieldBuilder {
    if (this.definition.required) throw duplicate('required')
    return new FieldBuilder({ ...this.definition, required: true })
  }

  nullable(): FieldBuilder {
    if (this.definition.nullable) throw duplicate('nullable')
    return new FieldBuilder({ ...this.definition, nullable: true })
  }

  // -- text rules -----------------------------------------------------------

  minLength(limit: number): FieldBuilder {
    return this.withLimit('minLength', limit, true)
  }

  maxLength(limit: number): FieldBuilder {
    return this.withLimit('maxLength', limit, true)
  }

  email(): FieldBuilder {
    this.assertRule('email')
    if (this.definition.url) throw conflict('email', 'url')
    return new FieldBuilder({ ...this.definition, email: true })
  }

  url(): FieldBuilder {
    this.assertRule('url')
    if (this.definition.email) throw conflict('url', 'email')
    return new FieldBuilder({ ...this.definition, url: true })
  }

  confirmed(): FieldBuilder {
    this.assertRule('confirmed')
    return new FieldBuilder({ ...this.definition, confirmed: true })
  }

  // -- text transformations ---------------------------------------------------

  trim(): FieldBuilder {
    this.assertRule('trim')
    return new FieldBuilder({ ...this.definition, trim: true })
  }

  lowercase(): FieldBuilder {
    this.assertRule('lowercase')
    return new FieldBuilder({ ...this.definition, lowercase: true })
  }

  // -- number rules ---------------------------------------------------------

  min(limit: number): FieldBuilder {
    return this.withLimit('min', limit, false)
  }

  max(limit: number): FieldBuilder {
    return this.withLimit('max', limit, false)
  }

  // -- array rules ----------------------------------------------------------

  minItems(limit: number): FieldBuilder {
    return this.withLimit('minItems', limit, true)
  }

  maxItems(limit: number): FieldBuilder {
    return this.withLimit('maxItems', limit, true)
  }

  // -- internals ------------------------------------------------------------

  private assertRule(rule: RuleName): void {
    const { kind } = this.definition

    if (!KIND_RULES[kind].has(rule)) {
      throw new TypeError(`Rule "${rule}" is not available on a "${kind}" validator`)
    }

    const alreadySet =
      rule === 'email' ||
      rule === 'url' ||
      rule === 'confirmed' ||
      rule === 'trim' ||
      rule === 'lowercase'
        ? this.definition[rule]
        : this.definition.limits[rule] !== undefined

    if (alreadySet) throw duplicate(rule)
  }

  private withLimit(rule: LimitName, value: number, integerOnly: boolean): FieldBuilder {
    this.assertRule(rule)
    assertLimit(rule, value, integerOnly)

    const limits = { ...this.definition.limits, [rule]: value }

    for (const [lower, upper] of LIMIT_PAIRS) {
      const lo = limits[lower]
      const hi = limits[upper]

      if (lo !== undefined && hi !== undefined && lo > hi) {
        throw new RangeError(`"${lower}" (${lo}) cannot be greater than "${upper}" (${hi})`)
      }
    }

    return new FieldBuilder({ ...this.definition, limits })
  }
}

function duplicate(rule: string): TypeError {
  return new TypeError(`Rule "${rule}" is already defined on this validator`)
}

function conflict(rule: string, other: string): TypeError {
  return new TypeError(`Rule "${rule}" cannot be combined with "${other}"`)
}

/**
 * The one place where the runtime class is presented under its public, state-aware type.
 * `FieldBuilder` implements every method; `Builder<S>` is the view that hides the ones
 * that are illegal for state `S`. Nothing about inference is hidden here: the state `S`
 * is always supplied explicitly by the factories in `validator.ts`.
 */
export function present<S extends State>(builder: FieldBuilder): Builder<S> {
  return builder as unknown as Builder<S>
}

export function validateEnumOptions(options: readonly string[]): void {
  if (!Array.isArray(options) || options.length === 0) {
    throw new TypeError('Validator.enum() requires a non-empty array of options')
  }

  for (const option of options) {
    if (typeof option !== 'string') {
      throw new TypeError('Validator.enum() options must be strings')
    }

    if (option.trim() === '') {
      throw new TypeError('Validator.enum() options cannot be empty')
    }
  }

  if (new Set(options).size !== options.length) {
    throw new TypeError('Validator.enum() options cannot contain duplicates')
  }
}
