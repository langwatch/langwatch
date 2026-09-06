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

/** RFC 9110: a `Content-Length` is a run of decimal digits and nothing else. */
const CONTENT_LENGTH = /^\d+$/;

/**
 * The size the wire states authoritatively, or null when it states none.
 *
 * A chunked upload declares no length at all, and a request carrying both
 * headers is only honest about the transfer encoding. A header that is not a
 * non-negative integer states nothing usable either: an unparsable or negative
 * value, and the `"a, b"` a repeated header collapses into, all read as
 * "unknown" rather than as zero, so the size is measured by draining instead of
 * trusted. Reading them as a number is what makes the comparison against the
 * cap false and lets the body through uncapped, and a strict HTTP parser is not
 * the only thing in front of this: behind the route adapter the header arrives
 * unvalidated.
 *
 * In every one of those cases the size is knowable only by reading the body.
 */
function declaredSize(headers: Headers): number | null {
  if (headers.has("transfer-encoding")) return null;

  const header = headers.get("content-length");
  if (header === null || !CONTENT_LENGTH.test(header)) return null;

  // A length past the safe-integer range cannot be compared against the cap
  // meaningfully, so it drains and gets refused at the cap like any other body.
  const declared = Number(header);
  return Number.isSafeInteger(declared) ? declared : null;
}

/**
 * The request a route reads after the body has been drained to measure it.
 *
 * Built from the URL rather than from the previous request, for the reason on
 * `bodyLimit` below: the constructor must never be handed another request
 * object to interpret.
 */
function withBufferedBody(
  request: Request,
  body: Uint8Array<ArrayBuffer>,
): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
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

    // A declared length is authoritative and free to read, so an oversized
    // body is rejected before a single byte arrives.
    const declared = declaredSize(request.headers);
    if (declared !== null) {
      return declared > maxSize ? onError(c, next) : next();
    }

    const body = await drainWithinCap(request.body, maxSize);
    if (!body) return onError(c, next);

    c.req.raw = withBufferedBody(request, body);

    return next();
  };
};
