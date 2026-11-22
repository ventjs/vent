import { ErrorHandler } from '../errors/error-handler'
import { HttpError } from '../errors/http-error'
import { requireJsonContentType } from '../http/content-negotiation'
import { DEFAULT_MAX_BODY_SIZE, readRequestBody } from '../http/read-request-body'
import { VentReply } from '../http/response/vent-response'
import type { Router } from '../routing/router'
import type { Context } from '../types/ctx'
import { HttpMethodEnum } from '../types/method'
import type { SocketIOIntegration } from '../types/socket-io-integration'
import Bun from 'bun'

const utf8Decoder = new TextDecoder()

export const HttpServer = (
  router: Router,
  port: number = 4000,
  callback?: () => void,
  socketIO?: SocketIOIntegration,
) => {
  const socketHandler = socketIO ? socketIO.engine.handler() : undefined
  const server = Bun.serve({
    port,
    ...((socketHandler && {
      idleTimeout: 30,
      websocket: socketHandler.websocket,
    }) as {
      idleTimeout: number
      websocket: NonNullable<typeof socketHandler>['websocket']
    }),

    async fetch(request): Promise<Response> {
      try {
        const url = new URL(request.url)
        // Route Socket.IO requests before the HTTP router.
        if (socketIO && url.pathname.replace(/\/+$/, '') === socketIO.path.replace(/\/+$/, '')) {
          return socketIO.engine.handleRequest(request, server)
        }
        const origin = request.headers.get('origin')

        if (request.method === HttpMethodEnum.OPTIONS) {
          const headers = new Headers()

          if (origin) {
            headers.set('Access-Control-Allow-Origin', origin)
            headers.set('Access-Control-Allow-Credentials', 'true')
            headers.set(
              'Access-Control-Allow-Methods',
              'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
            )
            headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            headers.set('Access-Control-Max-Age', '86400')
            headers.set('Vary', 'Origin')
          }

          return new Response(null, {
            status: 204,
            headers,
          })
        }

        const matchedRoute = router.match(request.method, url.pathname)

        if (!matchedRoute) {
          const allowed = router.allowedMethods(url.pathname)

          if (allowed.length > 0) {
            console.error(
              `Method Not Allowed\n` +
                `Requested Method: ${request.method}\n` +
                `Path: ${url.pathname}\n` +
                `Allowed Methods: ${allowed.join(', ')}`,
            )

            return Response.json(
              { error: 'Method Not Allowed' },
              {
                status: 405,
                headers: {
                  Allow: allowed.join(', '),
                },
              },
            )
          }

          console.warn(
            `Route Not Found\n` +
              `Requested Method: ${request.method}\n` +
              `Requested Path: ${url.pathname}\n` +
              `The requested route does not exist.`,
          )

          throw new HttpError(404, 'Not Found')
        }

        const { handler, params } = matchedRoute

        const contentLength = request.headers.get('content-length')

        if (contentLength !== null && Number(contentLength) > DEFAULT_MAX_BODY_SIZE) {
          throw new HttpError(413, 'Content Too Large')
        }

        const ctx: Context = {
          request,
          method: request.method,
          url,
          path: url.pathname,
          params,
          query: url.searchParams,
          headers: request.headers,
          formData: async () => {
            const body = await readRequestBody(request)

            const contentType = request.headers.get('content-type')

            if (!contentType) {
              throw new HttpError(400, 'Missing Content-Type')
            }

            const response = new Response(
              body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
              {
                headers: { 'Content-Type': contentType },
              },
            )

            try {
              return await response.formData()
            } catch {
              throw new HttpError(400, 'Invalid form data')
            }
          },
          json: async <T = unknown>(): Promise<T> => {
            requireJsonContentType(request.headers.get('content-type'))

            const body = await readRequestBody(request)

            try {
              return JSON.parse(utf8Decoder.decode(body)) as T
            } catch {
              throw new HttpError(400, 'Invalid JSON body')
            }
          },

          text: async () => {
            const body = await readRequestBody(request)
            return utf8Decoder.decode(body)
          },
        }

        const reply = VentReply()

        const result = await handler(ctx, reply)

        if (result instanceof Response) {
          return result
        }

        console.error(
          `Handler did not return a valid Response\n` +
            `Method: ${request.method}\n` +
            `Path: ${url.pathname}\n` +
            `Expected: Response\n` +
            `Received: ${result === undefined ? 'undefined' : typeof result}`,
        )

        return ErrorHandler.handle(new Error('Handler did not send a response'))
      } catch (error) {
        console.error('An error occurred while handling the request', error)
        return ErrorHandler.handle(error)
      }
    },
  })

  callback?.()

  return server
}
