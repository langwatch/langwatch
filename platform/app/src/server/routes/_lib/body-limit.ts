import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const ERROR_MESSAGE = "Payload Too Large";

export interface BodyLimitOptions {
  /** Maximum accepted body size, in bytes, as it arrives on the wire. */
  maxSize: number;
  /** Replaces the default 413 response. */
  onError?: MiddlewareHandler;
}

/**
 * Drains `body`, stopping the moment `maxSize` is passed so an oversized
 * upload is never fully buffered. Returns null once the cap is exceeded.
 */
async function drainWithinCap(
  body: ReadableStream<Uint8Array>,
  maxSize: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxSize) return null;
    chunks.push(value);
  }

  const drained = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    drained.set(chunk, offset);
    offset += chunk.length;
  }
  return drained;
}

/**
 * Caps the size of a request body, rejecting anything larger with 413.
 *
 * This is the app's own middleware rather than `hono/body-limit` because that
 * one is incompatible with how the Node bridge is wired. When a request has no
 * `Content-Length` — a chunked upload, which is what the OpenTelemetry OTLP
 * exporters send — the size can only be known by draining the stream, so the
 * body has to be put back for the route to read. Hono does that with
 * `new Request(c.req.raw, init)`, and `@hono/node-server` hands Hono a lazy
 * stand-in for the incoming message rather than a real `Request`. Only the
 * `Request` subclass that adapter installs globally knows how to unwrap that
 * stand-in, and `src/start.ts` passes `overrideGlobalObjects: false` so the
 * process keeps the platform's own globals. The global constructor therefore
 * receives an object it does not recognise and throws, turning every chunked
 * upload into a 500.
 *
 * Rebuilding from the URL sidesteps it: the buffered bytes, method, headers and
 * abort signal are carried over explicitly, so the constructor never has to
 * interpret another request object.
 */
export const bodyLimit = (options: BodyLimitOptions): MiddlewareHandler => {
  const { maxSize } = options;
  const onError =
    options.onError ??
    (() => {
      throw new HTTPException(413, {
        res: new Response(ERROR_MESSAGE, { status: 413 }),
      });
    });

  return async function bodyLimitMiddleware(c, next) {
    const request = c.req.raw;
    if (!request.body) return next();

    const headers = request.headers;

    // A declared length is authoritative and free to read, so an oversized
    // body is rejected before a single byte arrives.
    if (headers.has("content-length") && !headers.has("transfer-encoding")) {
      const declared = parseInt(headers.get("content-length") ?? "0", 10);
      return declared > maxSize ? onError(c, next) : next();
    }

    const body = await drainWithinCap(request.body, maxSize);
    if (!body) return onError(c, next);

    c.req.raw = new Request(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    });

    return next();
  };
};
