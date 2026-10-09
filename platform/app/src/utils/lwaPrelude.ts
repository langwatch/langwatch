/**
 * Reading a Lambda Web Adapter response.
 *
 * The per-project nlpgo function runs the adapter in RESPONSE_STREAM mode
 * (`optimization_studio/server/lambda` sets `AWS_LWA_INVOKE_MODE`), which
 * prefixes every response with a JSON prelude (`{"statusCode":...,
 * "headers":{...},"cookies":[]}`), then eight zero bytes, then the body.
 *
 * Both response paths have to understand that framing: the streaming one in
 * `optimization_studio/server/lambda` strips the prelude chunk by chunk before
 * the SSE parser sees it, and the buffered one in `utils/lambdaFetch.ts` reads
 * the status out of it. This module is the single place that knows the shape,
 * so the two cannot disagree about it. It imports nothing, by design, because
 * the framing is byte layout rather than deployment behaviour.
 */

/** The adapter delimits the JSON prelude from the body with 8 zero bytes. */
export const LWA_PRELUDE_SEPARATOR_LEN = 8;

/** Returns the index of the first 8-zero-byte run in `buf`, or -1 if
 *  not present. Used to locate the LWA RESPONSE_STREAM prelude/body
 *  boundary. SSE response bodies are text and never contain runs of 8
 *  NULs, so a false-positive on the body side is not a practical
 *  concern. The buffer parameter is typed as Uint8Array<ArrayBufferLike>
 *  so AWS SDK PayloadChunk.Payload values flow through without an extra
 *  copy. */
export function findLWAPreludeSeparator(
  buf: Uint8Array<ArrayBufferLike>,
): number {
  for (let i = 0; i + LWA_PRELUDE_SEPARATOR_LEN <= buf.length; i++) {
    let allZero = true;
    for (let j = 0; j < LWA_PRELUDE_SEPARATOR_LEN; j++) {
      if (buf[i + j] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) return i;
  }
  return -1;
}

/** Allocates a new Uint8Array containing `a` followed by `b`. The
 *  output owns a fresh ArrayBuffer (Uint8Array<ArrayBuffer>) so
 *  ReadableStreamDefaultController.enqueue and other strict consumers
 *  accept it without a buffer-type mismatch. */
export function concatBytes(
  a: Uint8Array<ArrayBufferLike>,
  b: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Splits a buffered invoke response payload into the engine's own HTTP status
 * and its body.
 *
 * `status` is null when the payload carries no prelude, which is what a
 * buffered-mode function returns: the whole payload is then the body and the
 * caller falls back to the invocation's own status. The invoke mode is
 * deployment configuration, so this reader must not corrupt a response shape
 * it was not expecting. `status` is also null for an unparseable
 * prelude, which is unknown rather than wrong.
 *
 * An empty body stays empty. Reading the payload by splitting on NUL and
 * taking the last non-empty segment instead returns the PRELUDE as the body
 * whenever the engine answered with no body at all.
 */
export function readLWAResponsePayload(payload: Uint8Array | undefined): {
  status: number | null;
  body: string;
} {
  if (!payload || payload.length === 0) {
    return { status: null, body: "" };
  }
  const separatorIndex = findLWAPreludeSeparator(payload);
  if (separatorIndex === -1) {
    return { status: null, body: Buffer.from(payload).toString("utf-8") };
  }
  const body = Buffer.from(
    payload.slice(separatorIndex + LWA_PRELUDE_SEPARATOR_LEN),
  ).toString("utf-8");
  const preludeText = Buffer.from(payload.slice(0, separatorIndex)).toString(
    "utf-8",
  );
  try {
    const statusCode = Number(
      (JSON.parse(preludeText) as { statusCode?: unknown }).statusCode,
    );
    if (
      Number.isInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode <= 599
    ) {
      return { status: statusCode, body };
    }
  } catch {
    // Fall through: an unparseable prelude leaves the status unknown.
  }
  return { status: null, body };
}
