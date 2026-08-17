/**
 * The one way the OpenAPI document goes out.
 *
 * Three routes publish it — the gateway contract's location, the well-known
 * one, and the `/api` one — and before this each called `c.json(apiDocument)`,
 * re-serialising a 5.8 MB object graph per request (2.8 ms, 1.3 MB of garbage,
 * measured). They now share this: precomputed bytes, one ETag, one cache
 * policy, so the three cannot drift in how they answer either.
 *
 * See specs/api-reference/api-discovery.feature.
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
 * Writes precomputed JSON bytes as the response body.
 *
 * `new Response` rather than `c.body`, because Hono types the latter as
 * `string | ArrayBuffer | ReadableStream` and a Node `Buffer` is none of those
 * — it is an `ArrayBufferView`, which `BodyInit` accepts. Going through
 * `Response` keeps the bytes as bytes; handing Hono a string instead would
 * reintroduce the UTF-8 encode this exists to avoid.
 *
 * The same Buffer backs every response. That is safe because nothing mutates
 * it, and it is the point: one allocation for the life of the process.
 */
export function jsonBytesResponse(
  bytes: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes, {
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

  return jsonBytesResponse(apiDocumentBytes, headers);
}
