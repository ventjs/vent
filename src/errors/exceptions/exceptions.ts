import {
  normalizeInput,
  type ErrorInput,
  type ExceptionOptions,
  HttpException,
} from './http-exception'

type ExceptionClass = new (input?: ErrorInput, options?: ExceptionOptions) => HttpException

const define = (status: number, code: string, defaultMessage: string): ExceptionClass =>
  class extends HttpException {
    constructor(input: ErrorInput = defaultMessage, options?: ExceptionOptions) {
      super(status, code, normalizeInput(input, defaultMessage), options)
    }
  }

export class BadRequestException extends define(400, 'BAD_REQUEST', 'Bad Request') {}
export class UnauthorizedException extends define(401, 'UNAUTHORIZED', 'Unauthorized') {}
export class ForbiddenException extends define(403, 'FORBIDDEN', 'Forbidden') {}
export class NotFoundException extends define(404, 'NOT_FOUND', 'Not Found') {}
export class MethodNotAllowedException extends define(
  405,
  'METHOD_NOT_ALLOWED',
  'Method Not Allowed',
) {}
export class ConflictException extends define(409, 'CONFLICT', 'Conflict') {}
export class UnprocessableEntityException extends define(
  422,
  'UNPROCESSABLE_ENTITY',
  'Unprocessable Entity',
) {}
export class TooManyRequestsException extends define(
  429,
  'TOO_MANY_REQUESTS',
  'Too Many Requests',
) {}
export class InternalServerErrorException extends define(
  500,
  'INTERNAL_SERVER_ERROR',
  'Internal Server Error',
) {}
export class ServiceUnavailableException extends define(
  503,
  'SERVICE_UNAVAILABLE',
  'Service Unavailable',
) {}
