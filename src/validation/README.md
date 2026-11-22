# VentJS v1.0.0 — Validation (Fluent API)

Standalone package containing the new validation system, so it can be built and tested on its own.

```bash
bun test          # 248 tests (runtime, type inference, IntelliSense, compiler rejection)
bunx tsc --noEmit # typecheck
```

Needs `bun`, `typescript` and `@types/bun` to be resolvable (in VentJS they come from the monorepo root; this package does not ship a `package.json` or `node_modules`).

## Files

| File                              | Role                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `src/validation/types.ts`         | Type-level design: `Builder<State>`, `InferSchema`, key-aware `Checked`           |
| `src/validation/field-builder.ts` | Immutable runtime builder + runtime guards for plain-JS callers                   |
| `src/validation/compile.ts`       | Turns builders into execution plans (messages built once, nested shapes included) |
| `src/validation/validator.ts`     | `Validator` (factories, `validate`, `configure`, plan cache) and the plan runner  |
| `src/validation/schema.ts`        | `defineSchema`                                                                    |
| `src/validation/date.ts`          | Strict ISO 8601 parsing for `Validator.date()`                                    |
| `src/validation/url.ts`           | Strict http(s) URL check (unchanged from 1.x)                                     |
| `src/validation/index.ts`         | Public exports                                                                    |
| `src/errors/errors-messages.ts`   | **Stand-in only** — keep your real `ErrorMessages`, do not copy this one          |

## Using it

`Validator.validate(data, schema)` is unchanged: it returns `{ valid, data, errors }`.

```ts
const UserSchema = defineSchema({
  name: Validator.string(3, 50).required(),
  email: Validator.text().required().email().trim().lowercase(),
  birthDate: Validator.date().nullable(),
  address: Validator.object({
    city: Validator.string(2, 100).required(),
    country: Validator.string(2, 100).required(),
  }).required(),
})

const validation = Validator.validate({ ...body }, UserSchema)

if (!validation.valid) {
  throw new HttpUnprocessableEntityError({
    success: false,
    message: 'validation failed',
    errors: validation.errors,
  })
}

// Typed by the schema: no `as` needed
const { name, email, birthDate, address } = validation.data
```

The type can also be derived:

```ts
type UserBody = InferSchema<typeof UserSchema>
```

## Error response

`errors` is still `Record<string, string[]>`. Nested fields use dot paths, and the message names the same path:

```json
{
  "success": false,
  "message": "validation failed",
  "errors": {
    "email": ["email must be a valid email"],
    "birthDate": ["birthDate must be a valid date"],
    "address.city": ["address.city must be at least 2 characters"],
    "address.country": ["address.country is required"]
  }
}
```

A value that is not an object at all is reported once, on the object:

```json
{
  "address": ["address must be an object"]
}
```

## `Validator.object(shape)`

- The shape uses the same fluent validators, with the same compile-time checks, to any depth.
- `required()` / `nullable()` work as for every other kind. `data` has the inferred nested type.
- Only plain objects (`{}` / `Object.create(null)`) are objects: arrays, `Date`, `Map` and class instances are rejected.
- Keys that are not in the shape are not validated and are kept, as at the top level.
- `confirmed()` inside an object looks for `<field>Confirmation` next to the field.

## `Validator.date()`

- Accepts a valid `Date`, or an ISO 8601 string (JSON cannot carry a `Date`):
  - `2026-01-31` (midnight UTC)
  - `2026-01-31T10:00:00Z`
  - `2026-01-31T10:00:00+03:00`
  - Optional fractional seconds.
- Rejected: impossible days (`2026-02-30`), a date-time without an offset (it would depend on the server's time zone), other formats, numbers (timestamps), booleans, objects, and an Invalid `Date`.
- `data` always holds a `Date` (inferred as `Date`). Only `required()` / `nullable()` exist on a date.

## `trim()` / `lowercase()`

- Only on `string()` and `text()`. Anything else is a TypeScript error and a runtime `TypeError`.
- They change the value in `data`. They always run **before** the checks, trim first, whatever the order they are chained in: `' ZEN@EXAMPLE.COM '` is checked by `email()` as `'zen@example.com'`, and `string(3, 50).trim()` counts the length after trimming.
- A blank nullable value is returned trimmed (`'   '` → `''`).
- `confirmed()` normalizes the confirmation the same way, so both sides are compared after the transformation.

## What `data` is

The input is never mutated. `data` is the input object itself when no value had to change, otherwise a shallow copy holding the transformed values (only the objects on the path to a changed value are copied).

## Tests

`tests/typecheck.test.ts` and `tests/intellisense.test.ts` use the TypeScript API directly (no child process, no `node_modules/.bin`), and find the project root as the nearest `tsconfig.json` above the tests.

If the tests are moved, adjust the `../src/...` imports of the test files and `ENTRY_FILE` in `tests/support/project.ts`.

## Integrating into VentJS

1. Replace the existing `src/validation/` implementation with the files in `src/validation/`. Preserve the actual VentJS `ErrorMessages` implementation; the import path `../errors/errors-messages` should continue to point to the existing error messages module.
2. In the package root `index.ts`, export `Validator`, `defineSchema` and the types from `./validation`, and remove the exports of `rules`, `passwordRules`, `ValidationRule`, `FieldRules`, `PasswordFieldRules`, `InvalidRules` and `SchemaFor`.
3. Move `tests/` next to your existing tests, and rewrite any old `rules([...])` usages to use the Fluent API.
