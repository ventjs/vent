export interface Reply {
  // Response basics
  send(body: string): Response
  json(data: unknown, status?: number): Response
  status(code: number): Reply
  header(name: string, value: string): Reply

  // 1xx — Informational
  Continue(): Response // 100
  SwitchingProtocols(): Response // 101
  Processing(): Response // 102
  EarlyHints(): Response // 103

  // 2xx — Success
  OK(data?: unknown): Response // 200
  Created(data?: unknown): Response // 201
  Accepted(data?: unknown): Response // 202
  NonAuthoritativeInfo(data?: unknown): Response // 203
  NoContent(): Response // 204
  ResetContent(): Response // 205
  PartialContent(data?: unknown): Response // 206
  MultiStatus(data?: unknown): Response // 207
  AlreadyReported(data?: unknown): Response // 208
  IMUsed(data?: unknown): Response // 226

  // 3xx — Redirection
  MultipleChoices(data?: unknown): Response // 300
  MovedPermanently(url?: string): Response // 301
  Found(url?: string): Response // 302
  SeeOther(url?: string): Response // 303
  NotModified(): Response // 304
  UseProxy(url?: string): Response // 305
  TemporaryRedirect(url?: string): Response // 307
  PermanentRedirect(url?: string): Response // 308

  // 4xx — Client Errors
  BadRequest(data?: unknown): Response // 400
  Unauthorized(data?: unknown): Response // 401
  PaymentRequired(data?: unknown): Response // 402
  Forbidden(data?: unknown): Response // 403
  NotFound(data?: unknown): Response // 404
  MethodNotAllowed(data?: unknown): Response // 405
  NotAcceptable(data?: unknown): Response // 406
  ProxyAuthenticationRequired(data?: unknown): Response // 407
  RequestTimeout(data?: unknown): Response // 408
  Conflict(data?: unknown): Response // 409
  Gone(data?: unknown): Response // 410
  LengthRequired(data?: unknown): Response // 411
  PreconditionFailed(data?: unknown): Response // 412
  ContentTooLarge(data?: unknown): Response // 413
  URITooLong(data?: unknown): Response // 414
  UnsupportedMediaType(data?: unknown): Response // 415
  RangeNotSatisfiable(data?: unknown): Response // 416
  ExpectationFailed(data?: unknown): Response // 417
  ImATeapot(data?: unknown): Response // 418
  MisdirectedRequest(data?: unknown): Response // 421
  UnprocessableContent(data?: unknown): Response // 422
  Locked(data?: unknown): Response // 423
  FailedDependency(data?: unknown): Response // 424
  TooEarly(data?: unknown): Response // 425
  UpgradeRequired(data?: unknown): Response // 426
  PreconditionRequired(data?: unknown): Response // 428
  TooManyRequests(data?: unknown): Response // 429
  RequestHeaderFieldsTooLarge(data?: unknown): Response // 431
  UnavailableForLegalReasons(data?: unknown): Response // 451

  // 5xx — Server Errors
  InternalServerError(data?: unknown): Response // 500
  NotImplemented(data?: unknown): Response // 501
  BadGateway(data?: unknown): Response // 502
  ServiceUnavailable(data?: unknown): Response // 503
  GatewayTimeout(data?: unknown): Response // 504
  HTTPVersionNotSupported(data?: unknown): Response // 505
  VariantAlsoNegotiates(data?: unknown): Response // 506
  InsufficientStorage(data?: unknown): Response // 507
  LoopDetected(data?: unknown): Response // 508
  NotExtended(data?: unknown): Response // 510
  NetworkAuthenticationRequired(data?: unknown): Response // 511
}
