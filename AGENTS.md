# AGENTS.md

Guidance for AI coding agents working on VentJS, a lightweight, modular backend framework built for speed and DX.

## Commands

```bash
bun install       # Install dependencies
bun test          # Run all tests (unit + e2e)
bun test <path>   # Run a single test file
```

Always run `bun test` after making changes. The full suite must pass before you consider a task done.

## Project Structure

```text
src/
  application/   Vent class and application setup
  errors/        HttpError and ErrorHandler
  di/            Dependency Injection container and module system
  http/          HTTP response helpers
  middleware/    MiddlewarePipeline and middleware
  routing/       Router (static and dynamic routes)
  server/        HttpServer (Bun.serve wrapper)
  types/         Shared types and interfaces
  validation/    Validator
test/
  unit/          Unit tests, mirroring src/
  e2e/           End-to-end tests against a real server
```

Keep this structure synchronized with the actual repository. If a source directory and its tests use different names, follow the existing test layout and import paths.

## Code Style

- TypeScript with explicit types. Avoid `any`.
- Tabs for indentation, single quotes, no semicolons.
- Keep functions small and focused. Prefer clear code over clever code.
- Follow the existing VentJS public API naming conventions.
- Use the existing handler parameter conventions, such as `ctx` and `reply`, where applicable.
- Keep user-facing log and error messages clear, consistent, and professional.
- Do not add dependencies without asking first. Any new dependency must have a license compatible with MIT.

## Architecture Rules

- Handlers and middleware must follow the return types and execution contracts defined by VentJS.
- Use the existing `HttpError` mechanism for expected HTTP errors. The HTTP server must handle errors through the project's error handler.
- The error handler must expose messages only for known HTTP errors. Unexpected errors must produce a generic `500 Internal Server Error`. Never leak internal error details to clients.
- A `405 Method Not Allowed` response must include the `Allow` header.
- Preserve the existing middleware registration and execution order. Do not change middleware behavior without updating the related tests and README.
- Routes must start with `/`. Registering the same method and path twice must follow the behavior defined by the existing router.
- Static routes must retain their priority over dynamic routes.
- Validator: `required` and `nullable` cannot be combined. A `null` value is rejected by type rules unless the field is `nullable`.

## Testing Rules

- Every bug fix needs a test that fails without the fix. Every feature needs unit tests, plus e2e tests if it affects server behavior.
- Mirror the `src/` layout under `test/unit/`, following the repository's existing exceptions.
- Tests that intentionally trigger errors must silence expected `console.error` and `console.warn` output with `spyOn(console, '...').mockImplementation(() => {})` and restore it in a `finally` block.
- `mock.module` paths are resolved relative to the test file, and the mock must be registered before the module under test is imported. Use `await import(...)` afterwards.
- Bun's `mock.module` is process-wide, so it can leak into other test files. Account for this when designing tests.
- Do not weaken or delete a test to make it pass. If a test and the code disagree, decide which one is correct and explain why.

## Documentation

When you change public behavior, update `README.md` and any affected tests in the same change.

Keep examples, API names, package references, and CLI instructions consistent with the current VentJS release.

## License

VentJS is released under the MIT License (see `LICENSE`). Keep the copyright notice and the MIT permission notice in all copies or substantial portions of the code. Do not remove or alter them, and do not change the license of the project. Code you contribute is licensed under the same MIT terms.

## Contributions

Read `CONTRIBUTING.md` before preparing a change. Keep each change focused on a single concern, and follow the commit message style described there: short, imperative mood.
