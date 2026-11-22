//  STAND-IN FILE — DO NOT COPY INTO THE REAL PROJECT.
//
// The real `errors/errors-messages.ts` was not part of the files provided, so this
// minimal class exists only to let this package compile and run its tests on its own.
// The validation code uses exactly one member of it: `invalidValidationSchema(field)`.
// In VentJS, keep your real file and ignore this one.

export class ErrorMessages {
  invalidValidationSchema(field: string): string {
    return `[VentJS] Field "${field}" cannot be both required and nullable.`
  }
}
