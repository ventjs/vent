// ---------------------------------------------------------------------------
// Type-level design of the Fluent API.
//
// Every validator is described by a small type-level "state":
//
//   kind      what it validates      string | text | number | boolean | array | enum | date | object
//   value     the TypeScript type it produces once validation succeeds
//   presence  unset | required | nullable   (must be settled before use in a schema)
//   used      the rules already applied (each rule may be applied once)
//
// `Builder<S>` exposes ONLY the methods that are still legal for state `S`
// (a `Pick` over the full method table), so an illegal method is neither suggested by
// IntelliSense nor callable: it simply does not exist on the type.
// ---------------------------------------------------------------------------

/** Phantom key that carries the state at type level. It has no runtime value. */
export declare const stateKey: unique symbol

export type Kind = 'string' | 'text' | 'number' | 'boolean' | 'array' | 'enum' | 'date' | 'object'

export type Presence = 'unset' | 'required' | 'nullable'

export type RuleName =
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'minItems'
  | 'maxItems'
  | 'email'
  | 'url'
  | 'confirmed'
  | 'trim'
  | 'lowercase'

export interface State {
  readonly kind: Kind
  readonly value: unknown
  readonly presence: Presence
  readonly used: RuleName
}

type WithPresence<S extends State, P extends 'required' | 'nullable'> = {
  readonly kind: S['kind']
  readonly value: S['value']
  readonly presence: P
  readonly used: S['used']
}

type Use<S extends State, R extends RuleName> = {
  readonly kind: S['kind']
  readonly value: S['value']
  readonly presence: S['presence']
  readonly used: S['used'] | R
}

/** A validator that has just been created: no presence chosen, no rule applied. */
export type Fresh<K extends Kind, V, U extends RuleName = never> = Builder<{
  readonly kind: K
  readonly value: V
  readonly presence: 'unset'
  readonly used: U
}>

// Which rules each kind supports. `trim` / `lowercase` are text transformations: they exist
// on `string` and `text` only. `date` and `object` take presence (required / nullable) only.
type KindRules<K extends Kind> = K extends 'string' | 'text'
  ? 'minLength' | 'maxLength' | 'email' | 'url' | 'confirmed' | 'trim' | 'lowercase'
  : K extends 'number'
    ? 'min' | 'max'
    : K extends 'array'
      ? 'minItems' | 'maxItems'
      : never

// `email` and `url` describe different formats, so they exclude each other.
type Conflicts<U extends RuleName> =
  | ('email' extends U ? 'url' : never)
  | ('url' extends U ? 'email' : never)

type Available<S extends State> =
  | (S['presence'] extends 'unset' ? 'required' | 'nullable' : never)
  | Exclude<KindRules<S['kind']>, S['used'] | Conflicts<S['used']>>

/** The complete method table. `Builder` picks from it what is still legal. */
interface Methods<S extends State> {
  required(): Builder<WithPresence<S, 'required'>>
  nullable(): Builder<WithPresence<S, 'nullable'>>

  minLength(limit: number): Builder<Use<S, 'minLength'>>
  maxLength(limit: number): Builder<Use<S, 'maxLength'>>
  email(): Builder<Use<S, 'email'>>
  url(): Builder<Use<S, 'url'>>
  confirmed(): Builder<Use<S, 'confirmed'>>

  // text transformations: they change the value that `validate` returns
  trim(): Builder<Use<S, 'trim'>>
  lowercase(): Builder<Use<S, 'lowercase'>>

  min(limit: number): Builder<Use<S, 'min'>>
  max(limit: number): Builder<Use<S, 'max'>>

  minItems(limit: number): Builder<Use<S, 'minItems'>>
  maxItems(limit: number): Builder<Use<S, 'maxItems'>>

  readonly [stateKey]: S
}

export type Builder<S extends State> = Pick<Methods<S>, Available<S> | typeof stateKey>

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export type AnyBuilder = { readonly [stateKey]: State }

/** Any object whose values are validators. */
export type ValidationSchema = Readonly<Record<string, AnyBuilder>>

// `.email()` is accepted on a field whose name contains "email" (case-insensitive):
// email, contactEmail, emailAddress ...
type IsEmailKey<K extends string> =
  Lowercase<K> extends `${string}email${string}` ? true : false

type Problems<K extends string, St extends State> =
  | (St['presence'] extends 'unset'
      ? `"${K}": call .required() or .nullable() before using it in a schema`
      : never)
  | ('confirmed' extends St['used']
      ? K extends 'password'
        ? never
        : `"${K}": .confirmed() is only allowed on the "password" field`
      : never)
  | ('email' extends St['used']
      ? IsEmailKey<K> extends true
        ? never
        : `"${K}": .email() is only allowed on a field whose name contains "email"`
      : never)

type CheckField<K extends string, F> = F extends { readonly [stateKey]: infer St extends State }
  ? [Problems<K, St>] extends [never]
    ? F
    : { readonly __error: Problems<K, St> }
  : F

/**
 * Key-aware check applied by `defineSchema` and `Validator.validate`.
 * A field that is fine stays as is; a field that breaks a rule becomes an
 * `{ __error: "..." }` object, so TypeScript reports the message on that property.
 */
export type Checked<S> = {
  [K in keyof S]: CheckField<K & string, S[K]>
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

type StateOf<F> = F extends { readonly [stateKey]: infer St extends State } ? St : never

type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * The data type implied by a schema: `required` fields are mandatory,
 * `nullable` fields are optional and may be `null`.
 */
export type InferSchema<S> = Simplify<
  {
    [K in keyof S as StateOf<S[K]>['presence'] extends 'required' ? K : never]: StateOf<
      S[K]
    >['value']
  } & {
    [K in keyof S as StateOf<S[K]>['presence'] extends 'nullable' ? K : never]?:
      | StateOf<S[K]>['value']
      | null
  }
>

// ---------------------------------------------------------------------------
// Results (same shape as 1.x)
// ---------------------------------------------------------------------------

export type ValidationErrors = Record<string, string[]>

export type ValidationResult<T> =
  | {
      valid: true
      data: T
      errors: ValidationErrors
    }
  | {
      valid: false
      errors: ValidationErrors
    }
