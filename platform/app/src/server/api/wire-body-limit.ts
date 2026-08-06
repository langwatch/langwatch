/**
 * Drop-in replacement for hono's `bodyLimit` that survives @hono/node-server.
 *
 * hono's `bodyLimit` handles a request without a Content-Length header (any
 * chunked sender — the OTel JS exporters among them) by buffering the stream
 * and then rebuilding the request as `new Request(c.req.raw, { body })`.
 * Under @hono/node-server the incoming `c.req.raw` is the adapter's lazy
 * lightweight request, not an undici `Request`, and undici's constructor
 * rejects it with `TypeError: Cannot read private member #state` — a 500 for
 * every chunked request on any route the middleware guards (hono 4.12.27 +
 * @hono/node-server 2.0.6).
 *
 * This version keeps hono's semantics — trust Content-Length when there is no
 * Transfer-Encoding, otherwise count the streamed bytes and reject past the
 * cap — but rebuilds the request from its URL string and a buffered body, so
 * no foreign request object ever reaches undici's constructor.
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";

const ERROR_MESSAGE = "Payload Too Large";

const reject = (): never => {
  const res = new Response(ERROR_MESSAGE, { status: 413 });
  throw new HTTPException(413, { res });
};

export const wireBodyLimit = ({
  maxSize,
}: {
  maxSize: number;
}): MiddlewareHandler => {
  return async function wireBodyLimitMiddleware(c: Context, next: Next) {
    const body = c.req.raw.body;
    if (!body) {
      return next();
    }

    const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
    const hasContentLength = c.req.raw.headers.has("content-length");
    if (hasContentLength && !hasTransferEncoding) {
      const contentLength = parseInt(
        c.req.raw.headers.get("content-length") ?? "0",
        10,
      );
      if (contentLength > maxSize) reject();
      return next();
    }

    let size = 0;
    const chunks: Uint8Array[] = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxSize) reject();
      chunks.push(value);
    }

    const buffered = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffered.set(chunk, offset);
      offset += chunk.length;
    }

    // The rebuilt request carries a fixed body, so the chunked framing header
    // no longer describes it; undici derives Content-Length from the buffer.
    const headers = new Headers(c.req.raw.headers);
    headers.delete("transfer-encoding");
    c.req.raw = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: buffered,
    });

    return next();
  };
};
