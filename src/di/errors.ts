import type { Token } from './types'

const names = (tokens: readonly Token[]): string => tokens.map((t) => t.name).join(' -> ')

export class DIError extends Error {
  constructor(message: string) {
    super(`[VentJS] ${message}`)
    this.name = new.target.name
  }
}

export class ProviderNotFoundError extends DIError {
  constructor(token: Token, requiredBy: readonly Token[]) {
    super(
      requiredBy.length > 0
        ? `No provider found for "${token.name}". Required by: ${names(requiredBy)}.`
        : `No provider found for "${token.name}".`,
    )
  }
}

export class CircularDependencyError extends DIError {
  constructor(chain: readonly Token[]) {
    super(`Circular dependency detected: ${names(chain)}.`)
  }
}

export class DuplicateProviderError extends DIError {
  constructor(token: Token) {
    super(`Provider "${token.name}" is already registered.`)
  }
}

export class InvalidExportError extends DIError {
  constructor(token: Token) {
    super(`Cannot export "${token.name}": it is not provided by this module or its imports.`)
  }
}

export class CircularModuleError extends DIError {
  constructor(chain: readonly { name: string }[]) {
    super(`Circular module import detected: ${chain.map((m) => m.name).join(' -> ')}.`)
  }
}
