import type { Reply } from '../../types/reply'
import { StatusCode } from './status-code'

type SendBody = Parameters<Reply['send']>[0]
type RedirectUrl = Parameters<Reply['Found']>[0]

type EmptyMethod = () => Response
type JsonMethod = (data?: unknown) => Response
type RedirectMethod = (url?: RedirectUrl) => Response

/**
 * Headers for string bodies when the developer did not set any headers.
 * Frozen and never mutated: the Response constructor copies it, so it is
 * not shared mutable state between requests.
 */
const TEXT_PLAIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/plain; charset=utf-8',
})

function assertFinalStatus(status: number): void {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new RangeError(`Invalid Fetch Response status: ${status}`)
  }
}

function hasNullBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

function jsonResponse(data: unknown, status: number, headers: Headers | undefined): Response {
  assertFinalStatus(status)

  if (hasNullBody(status)) {
    throw new TypeError(`Status ${status} cannot have a response body`)
  }

  return headers === undefined
    ? Response.json(data, { status })
    : Response.json(data, { status, headers })
}

function emptyResponse(status: number, headers: Headers | undefined): Response {
  assertFinalStatus(status)

  return headers === undefined
    ? new Response(null, { status })
    : new Response(null, { status, headers })
}

function redirectResponse(
  status: number,
  url: string = '/',
  headers: Headers | undefined,
): Response {
  const location = new URL(url, 'http://localhost')

  if (headers === undefined) {
    return new Response(null, {
      status,
      headers: { Location: location.href },
    })
  }

  // Same semantics as before: custom headers are copied into a fresh
  // Headers object and Location is appended after them.
  const copy = new Headers(headers)
  copy.append('Location', location.href)

  return new Response(null, { status, headers: copy })
}

/**
 * Per-request response manager.
 *
 * Only two things are allocated per request: this instance and, lazily, a
 * Headers object the first time `header()` is called. The logic itself lives
 * once at module level (the helpers above) and once on the prototype (the
 * accessors below).
 *
 * Every public member is a prototype *getter* that returns a small closure
 * bound to the instance, instead of a prototype method. That is deliberate:
 * the previous implementation created every method as an arrow function, so
 * `const { OK, json } = reply`, `const fn = reply.NotFound` and
 * `res.json = mock` all worked. Plain prototype methods would lose `this`
 * in those cases. A getter keeps them working, and the closure is only
 * allocated for members that are actually used.
 */
class VentReplyManager implements Reply {
  #status: number = StatusCode.OK
  #headers: Headers | undefined = undefined

  get send(): (body: SendBody) => Response {
    return (body: SendBody): Response => {
      const customHeaders = this.#headers
      const isString = typeof body === 'string'

      if (customHeaders === undefined) {
        return isString
          ? new Response(body, {
              status: this.#status,
              headers: TEXT_PLAIN_HEADERS,
            })
          : new Response(body, { status: this.#status })
      }

      const headers = new Headers(customHeaders)

      if (isString && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'text/plain; charset=utf-8')
      }

      return new Response(body, { status: this.#status, headers })
    }
  }

  get json(): (data: unknown, status?: number) => Response {
    return (data: unknown, status: number = this.#status): Response =>
      jsonResponse(data, status, this.#headers)
  }

  get status(): (code: number) => this {
    return (code: number): this => {
      this.#status = code
      return this
    }
  }

  get header(): (name: string, value: string) => this {
    return (name: string, value: string): this => {
      if (this.#headers === undefined) {
        this.#headers = new Headers()
      }
      this.#headers.set(name, value)
      return this
    }
  }

  get Continue(): EmptyMethod {
    return () => emptyResponse(StatusCode.Continue, this.#headers)
  }

  get SwitchingProtocols(): EmptyMethod {
    return () => emptyResponse(StatusCode.SwitchingProtocols, this.#headers)
  }

  get Processing(): EmptyMethod {
    return () => emptyResponse(StatusCode.Processing, this.#headers)
  }

  get EarlyHints(): EmptyMethod {
    return () => emptyResponse(StatusCode.EarlyHints, this.#headers)
  }

  get OK(): JsonMethod {
    return (data: unknown = { message: 'OK' }) => jsonResponse(data, StatusCode.OK, this.#headers)
  }

  get Created(): JsonMethod {
    return (data: unknown = { message: 'Created' }) =>
      jsonResponse(data, StatusCode.Created, this.#headers)
  }

  get Accepted(): JsonMethod {
    return (data: unknown = { message: 'Accepted' }) =>
      jsonResponse(data, StatusCode.Accepted, this.#headers)
  }

  get NonAuthoritativeInfo(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.NonAuthoritativeInfo, this.#headers)
  }

  get NoContent(): EmptyMethod {
    return () => emptyResponse(StatusCode.NoContent, this.#headers)
  }

  get ResetContent(): EmptyMethod {
    return () => emptyResponse(StatusCode.ResetContent, this.#headers)
  }

  get PartialContent(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.PartialContent, this.#headers)
  }

  get MultiStatus(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.MultiStatus, this.#headers)
  }

  get AlreadyReported(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.AlreadyReported, this.#headers)
  }

  get IMUsed(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.IMUsed, this.#headers)
  }

  get MultipleChoices(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.MultipleChoices, this.#headers)
  }

  get MovedPermanently(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.MovedPermanently, url, this.#headers)
  }

  get Found(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.Found, url, this.#headers)
  }

  get SeeOther(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.SeeOther, url, this.#headers)
  }

  get NotModified(): EmptyMethod {
    return () => emptyResponse(StatusCode.NotModified, this.#headers)
  }

  get UseProxy(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.UseProxy, url, this.#headers)
  }

  get TemporaryRedirect(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.TemporaryRedirect, url, this.#headers)
  }

  get PermanentRedirect(): RedirectMethod {
    return (url?: RedirectUrl) => redirectResponse(StatusCode.PermanentRedirect, url, this.#headers)
  }

  get BadRequest(): JsonMethod {
    return (data: unknown = { error: 'Bad Request' }) =>
      jsonResponse(data, StatusCode.BadRequest, this.#headers)
  }

  get Unauthorized(): JsonMethod {
    return (data: unknown = { error: 'Unauthorized' }) =>
      jsonResponse(data, StatusCode.Unauthorized, this.#headers)
  }

  get PaymentRequired(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.PaymentRequired, this.#headers)
  }

  get Forbidden(): JsonMethod {
    return (data: unknown = { error: 'Forbidden' }) =>
      jsonResponse(data, StatusCode.Forbidden, this.#headers)
  }

  get NotFound(): JsonMethod {
    return (data: unknown = { error: 'Not Found' }) =>
      jsonResponse(data, StatusCode.NotFound, this.#headers)
  }

  get MethodNotAllowed(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.MethodNotAllowed, this.#headers)
  }

  get NotAcceptable(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.NotAcceptable, this.#headers)
  }

  get ProxyAuthenticationRequired(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.ProxyAuthenticationRequired, this.#headers)
  }

  get RequestTimeout(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.RequestTimeout, this.#headers)
  }

  get Conflict(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.Conflict, this.#headers)
  }

  get Gone(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.Gone, this.#headers)
  }

  get LengthRequired(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.LengthRequired, this.#headers)
  }

  get PreconditionFailed(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.PreconditionFailed, this.#headers)
  }

  get ContentTooLarge(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.ContentTooLarge, this.#headers)
  }

  get URITooLong(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.URITooLong, this.#headers)
  }

  get UnsupportedMediaType(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.UnsupportedMediaType, this.#headers)
  }

  get RangeNotSatisfiable(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.RangeNotSatisfiable, this.#headers)
  }

  get ExpectationFailed(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.ExpectationFailed, this.#headers)
  }

  get ImATeapot(): JsonMethod {
    return (data: unknown = { message: "I'm a teapot" }) =>
      jsonResponse(data, StatusCode.ImATeapot, this.#headers)
  }

  get MisdirectedRequest(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.MisdirectedRequest, this.#headers)
  }

  get UnprocessableContent(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.UnprocessableContent, this.#headers)
  }

  get Locked(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.Locked, this.#headers)
  }

  get FailedDependency(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.FailedDependency, this.#headers)
  }

  get TooEarly(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.TooEarly, this.#headers)
  }

  get UpgradeRequired(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.UpgradeRequired, this.#headers)
  }

  get PreconditionRequired(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.PreconditionRequired, this.#headers)
  }

  get TooManyRequests(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.TooManyRequests, this.#headers)
  }

  get RequestHeaderFieldsTooLarge(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.RequestHeaderFieldsTooLarge, this.#headers)
  }

  get UnavailableForLegalReasons(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.UnavailableForLegalReasons, this.#headers)
  }

  get InternalServerError(): JsonMethod {
    return (data: unknown = { error: 'Internal Server Error' }) =>
      jsonResponse(data, StatusCode.InternalServerError, this.#headers)
  }

  get NotImplemented(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.NotImplemented, this.#headers)
  }

  get BadGateway(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.BadGateway, this.#headers)
  }

  get ServiceUnavailable(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.ServiceUnavailable, this.#headers)
  }

  get GatewayTimeout(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.GatewayTimeout, this.#headers)
  }

  get HTTPVersionNotSupported(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.HTTPVersionNotSupported, this.#headers)
  }

  get VariantAlsoNegotiates(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.VariantAlsoNegotiates, this.#headers)
  }

  get InsufficientStorage(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.InsufficientStorage, this.#headers)
  }

  get LoopDetected(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.LoopDetected, this.#headers)
  }

  get NotExtended(): JsonMethod {
    return (data: unknown = {}) => jsonResponse(data, StatusCode.NotExtended, this.#headers)
  }

  get NetworkAuthenticationRequired(): JsonMethod {
    return (data: unknown = {}) =>
      jsonResponse(data, StatusCode.NetworkAuthenticationRequired, this.#headers)
  }
}

/**
 * Members are accessors so they stay detachable (see the class comment), but
 * the old object exposed them as plain writable properties. Give every
 * accessor a setter that turns an assignment into an own property on that
 * instance, so `reply.json = mock` keeps working. Runs once at module load.
 */
for (const key of Object.getOwnPropertyNames(VentReplyManager.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(VentReplyManager.prototype, key)

  if (descriptor?.get === undefined) continue

  Object.defineProperty(VentReplyManager.prototype, key, {
    ...descriptor,
    set(this: object, value: unknown) {
      Object.defineProperty(this, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    },
  })
}

export function VentReply(): Reply {
  return new VentReplyManager()
}
