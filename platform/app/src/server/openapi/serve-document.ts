/**
 * The one way the OpenAPI document goes out.
 *
 * Three routes publish it — the gateway contract's location, the well-known
 * one, and the `/api` one — and before this each called `c.json(apiDocument)`,
 * re-serialising a 5.8 MB object graph per request (2.8 ms, 1.3 MB of garbage,
 * measured). They now share this: precomputed bytes, one ETag, one cache
 * policy, so the three cannot drift in how they answer either.
 *
 * See packages/api/specs/api-discovery.feature.
 */

import type { Context } from "hono";

import { apiDocumentBytes, apiDocumentETag } from "./document.js";

/**
 * Public and immutable for the life of a deploy, but not immutable across
 * deploys — so a short max-age with revalidation, not `immutable`. An agent
 * that polls gets a 304 costing ~200 bytes instead of 688 KB, and a redeploy
 * that actually changed the document is picked up within the minute.
 */
const CACHE_CONTROL = "public, max-age=60, must-revalidate";

/**
 * True when the caller already holds these bytes.
 *
 * `If-None-Match` is a comma-separated list and may carry the `W/` weak
 * prefix, so a bare equality check against our tag would miss a hit and send
 * 688 KB to a client that did not need it — a wrong answer that looks exactly
 * like a working one, which is why it is worth handling rather than assuming
 * clients send the simple form.
 */
function alreadyHasIt(ifNoneMatch: string | undefined): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .includes(apiDocumentETag);
}

/**
 * Writes precomputed JSON bytes as the response body, without copying them.
 *
 * The body is a `ReadableStream` that enqueues the shared bytes, and that is
 * load-bearing rather than stylistic. Handing the `Uint8Array` straight to
 * `new Response(bytes)` COPIES it: 200 responses over one shared 688 KB buffer
 * allocated 134.4 MB of `arrayBuffers`, identical to passing an explicit
 * `.slice()`, where the stream form allocated 0. Precomputing the bytes and
 * then copying them per request would have kept the CPU saving and thrown away
 * the allocation one.
 *
 * Enqueuing the same array into concurrent streams is safe: a non-transferable
 * `ReadableStream` does not detach or mutate what it is given, and nothing here
 * writes to it.
 *
 * Not `c.body` either, which Hono types as `string | ArrayBuffer |
 * ReadableStream` — a string body would reintroduce the UTF-8 encode this
 * exists to avoid.
 *
 * One caveat left open: the Hono Node adapter may still copy on its way to the
 * socket. That is a transient write buffer rather than a retained allocation,
 * and it is below what this module can control.
 */
export function jsonBytesResponse({
  bytes,
  headers = {},
}: {
  bytes: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
}): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

/** Answers a request for the OpenAPI document, 200 with bytes or 304 without. */
export function respondWithApiDocument(c: Context): Response {
  const headers = {
    ETag: apiDocumentETag,
    "Cache-Control": CACHE_CONTROL,
  };

  if (alreadyHasIt(c.req.header("if-none-match"))) {
    // 304 carries no body and no Content-Length by definition.
    return new Response(null, { status: 304, headers });
  }

  return jsonBytesResponse({ bytes: apiDocumentBytes, headers });
}
