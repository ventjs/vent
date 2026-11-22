// Application
export { Vent } from './application/vent'

// http errors
export { HttpError } from './errors/http-error'

// exceptions
export {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  ConflictException,
  UnprocessableEntityException,
  TooManyRequestsException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from './errors/exceptions/exceptions'

export { isHttpException } from './errors/exceptions/http-exception'

// Middlewares
export { AuthMiddleware } from './middleware/auth-middleware'
export { corsMiddleware } from './middleware/cors-middleware'
export { loggerMiddleware } from './middleware/logger-middleware'
export { MiddlewarePipeline } from './middleware/middleware-pipeline'

// DI
export { DIModule } from './di/module'
export { bind } from './di/bind'
export { defineAuth } from './di/module'

// types
export type { AuthToken } from './types/auth-token'
export type { ContextHandler } from './types/handler'
export type { HttpMethod } from './types/method'
export type { ContextMiddleware } from './types/context-middleware'
export type { Context } from './types/ctx'
export type { Reply } from './types/reply'
export type { NextFunc } from './types/context-middleware'
export type { RegisteredRoute } from './types/registered-route'

// Validations
export { Validator } from './validation/src/validation/validator'
export { defineSchema } from './validation/src/validation/schema'
export type {
  Builder,
  InferSchema,
  ValidationErrors,
  ValidationResult,
  ValidationSchema,
} from './validation/src/validation/types'
