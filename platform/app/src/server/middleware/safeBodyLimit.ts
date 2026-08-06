/**
 * Drop-in replacement for hono's `bodyLimit` that survives the bundled
 * server runtime.
 *
 * hono's middleware, on a request WITHOUT a content-length (chunked
 * uploads — which is how OTLP exporters POST), buffers the body and then
 * rebuilds the request as `new Request(c.req.raw, init)`. Under the
 * bundled server entrypoint (#6557) the request instance and the global
 * `Request` constructor come from different undici realms, so that
 * rebuild throws `TypeError: Cannot read private member #state` and every
 * chunked POST 500s before reaching the route. That took down the whole
 * OTLP ingest surface when #6602 added `bodyLimit` to those routes; the
 * SDK e2e suite was the first thing to notice (main skips it on most
 * pushes).
 *
 * Same contract as hono's: content-length fast path, stream-count
 * otherwise, 413 `Payload Too Large` via HTTPException on breach. The one
 * difference is the rebuild: the request is reconstructed from PLAIN
 * parts (url / method / headers / buffered bytes) using the incoming
 * request's own constructor, so no foreign Request instance is ever
 * introspected — realm-safe by construction.
 */

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const ERROR_MESSAGE = "Payload Too Large";

const payloadTooLarge = (): never => {
  const res = new Response(ERROR_MESSAGE, { status: 413 });
  throw new HTTPException(413, { res });
};

/** Stream-count the body, 413ing the moment the running total exceeds
 * `maxSize`; returns the buffered bytes for the rebuilt request. */
async function bufferWithinLimit(
  body: ReadableStream<Uint8Array>,
  maxSize: number,
): Promise<Uint8Array> {
  let size = 0;
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxSize) payloadTooLarge();
    chunks.push(value);
  }

  const buffered = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffered.set(chunk, offset);
    offset += chunk.length;
  }
  return buffered;
}

export const safeBodyLimit = ({ maxSize }: { maxSize: number }) =>
  createMiddleware(async (c, next) => {
    const raw = c.req.raw;
    if (!raw.body) {
      return next();
    }

    const hasTransferEncoding = raw.headers.has("transfer-encoding");
    const hasContentLength = raw.headers.has("content-length");
    if (hasContentLength && !hasTransferEncoding) {
      const contentLength = parseInt(
        raw.headers.get("content-length") ?? "0",
        10,
      );
      if (contentLength > maxSize) payloadTooLarge();
      return next();
    }

    const buffered = await bufferWithinLimit(raw.body, maxSize);

    // Rebuild from plain parts with the request's OWN constructor — never
    // pass the (possibly foreign-realm) Request instance itself.
    const RequestCtor = raw.constructor as typeof Request;
    c.req.raw = new RequestCtor(raw.url, {
      method: raw.method,
      headers: new Headers(raw.headers),
      // Uint8Array<ArrayBufferLike> isn't assignable to BodyInit under the
      // DOM lib types when the backing buffer could be a SharedArrayBuffer;
      // these chunks always come from the request stream (plain buffers).
      body: buffered as unknown as BodyInit,
    });
    return next();
  });
