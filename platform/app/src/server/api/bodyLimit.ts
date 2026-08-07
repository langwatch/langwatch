/**
 * A body-size cap for Hono routes that survives a request with no
 * `Content-Length`.
 *
 * Drop-in for `hono/body-limit`: same options, same 413, same drain-count-replay
 * behaviour. It exists because hono's own version crashes on exactly the
 * requests our ingest endpoints receive most.
 *
 * When a request declares no length, hono reads the body to measure it and then
 * rebuilds the request with `new Request(c.req.raw, { body })`. That works only
 * while the global `Request` is the same class the server adapter handed it.
 * `src/start.ts` mounts `getRequestListener` with `overrideGlobalObjects: false`
 * so the adapter never patches the process globals, which leaves the global as
 * undici's while the request is `@hono/node-server`'s own. undici's constructor
 * reads a private field off whatever object it is given, so the call throws
 * `TypeError: Cannot read private member #state from an object whose class did
 * not declare it` and every such request answers 500.
 *
 * That is not an edge case. A `Content-Length` requires knowing the size before
 * sending, so any client that streams omits it, and Node's http client omits it
 * by default: the OpenTelemetry JS exporter sends `Transfer-Encoding: chunked`,
 * which made `/api/otel/v1/*` and `/api/collector` refuse every trace from a
 * Node SDK that talks to the app directly. A proxy that buffers request bodies
 * adds the header on the way through and hides the whole thing, which is why it
 * survived: it reproduces against the app, not through an ingress.
 *
 * Building the replacement from `url` + init never hands the foreign request to
 * the constructor, so the same measure-then-replay works on every runtime.
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * The refusal hono publishes, kept byte-identical on purpose: this module is a
 * crash fix, and a route's 413 contract is not something it should redefine on
 * the way past.
 */
function payloadTooLarge(): never {
  throw new HTTPException(413, {
    res: new Response("Payload Too Large", { status: 413 }),
  });
}

/**
 * Typed as `MiddlewareHandler` exactly as hono's is. A narrower signature stops
 * the route's path generics flowing through it, and `c.req.param("evaluator")`
 * on a route behind it widens to `string | undefined`.
 */
export function bodyLimit({ maxSize }: { maxSize: number }): MiddlewareHandler {
  return async function boundedBody(c: Context, next: Next): Promise<void> {
    const body = c.req.raw.body;
    if (!body) return next();

    const declared = declaredLength(c);
    if (declared !== null) {
      if (declared > maxSize) payloadTooLarge();
      return next();
    }

    c.req.raw = replayableRequest(
      c.req.raw,
      await drainWithin({ body, maxSize }),
    );
    return next();
  };
}

/**
 * How many bytes the sender promised, or null when it did not say.
 *
 * A promise settles the question without reading anything, which is the reason
 * to send one. `transfer-encoding` wins when both headers are present: the
 * length then describes the decoded body rather than what arrives on the wire,
 * so it cannot bound the read.
 */
function declaredLength(c: Context): number | null {
  if (c.req.header("transfer-encoding") !== undefined) return null;
  const declared = c.req.header("content-length");
  if (declared === undefined) return null;
  const length = Number.parseInt(declared, 10);
  return Number.isFinite(length) ? length : null;
}

/** The body, read whole, refusing the moment it passes the cap. */
async function drainWithin({
  body,
  maxSize,
}: {
  body: ReadableStream<Uint8Array>;
  maxSize: number;
}): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  let held = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      held += value.byteLength;
      if (held > maxSize) {
        await reader.cancel();
        payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}

/**
 * The same request with a fresh, replayable body.
 *
 * From `url` + init rather than from the request object: see the module
 * docstring. The headers are copied wholesale so the handler still sees the
 * content type and credentials it authenticates on.
 */
function replayableRequest(original: Request, chunks: Uint8Array[]): Request {
  return new Request(original.url, {
    method: original.method,
    headers: replayableHeaders(original.headers),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    // Node requires this whenever a request body is a stream.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

/**
 * Everything the caller sent except the framing.
 *
 * `transfer-encoding` and `content-length` describe how the body arrived on a
 * socket this request no longer has, and undici rejects a `Request` whose body
 * is a stream while its headers claim a length. Dropping both leaves the
 * handler reading the same bytes it would have read.
 */
function replayableHeaders(original: Headers): Headers {
  const headers = new Headers(original);
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  return headers;
}
