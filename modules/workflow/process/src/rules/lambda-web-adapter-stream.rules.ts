/**
 * The Lambda Web Adapter's RESPONSE_STREAM framing: a JSON prelude, eight zero
 * bytes, then the body. A raw chunk puts a bare `{` before the first SSE frame.
 * @see specs/nlp-go/studio-lambda-cache.feature
 */

/** The prelude and the body are separated by eight zero bytes. */
export const LWA_PRELUDE_SEPARATOR_LENGTH = 8;

/** The legacy default: an unreadable prelude is not a failed response. */
export const LWA_DEFAULT_STATUS = 200;

/**
 * The index of the first eight-zero-byte run, or -1. SSE bodies are text and
 * never carry eight NULs in a row, so a false positive is not a concern.
 */
export function findLwaPreludeSeparator(bytes: Uint8Array<ArrayBufferLike>): number {
  for (let start = 0; start + LWA_PRELUDE_SEPARATOR_LENGTH <= bytes.length; start += 1) {
    let allZero = true;
    for (let offset = 0; offset < LWA_PRELUDE_SEPARATOR_LENGTH; offset += 1) {
      if (bytes[start + offset] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) return start;
  }
  return -1;
}

/** The status the prelude declared, or the legacy default when it is unreadable. */
export function readLwaPreludeStatus(prelude: Uint8Array<ArrayBufferLike>): number {
  try {
    const text = Buffer.from(prelude.buffer, prelude.byteOffset, prelude.byteLength).toString(
      "utf8",
    );
    const parsed: unknown = JSON.parse(text);
    const status = Number((parsed as { statusCode?: unknown }).statusCode);
    return Number.isFinite(status) ? status : LWA_DEFAULT_STATUS;
  } catch {
    return LWA_DEFAULT_STATUS;
  }
}

/**
 * A buffered invoke payload split into the engine's own status and its body. The status is
 * null when there is no prelude or it names no valid status; the caller falls back then.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
export function readLwaResponsePayload(payload: Uint8Array<ArrayBufferLike> | undefined): {
  status: number | null;
  body: string;
} {
  if (!payload || payload.length === 0) return { status: null, body: "" };

  const separator = findLwaPreludeSeparator(payload);
  if (separator === -1) return { status: null, body: Buffer.from(payload).toString("utf-8") };

  const body = Buffer.from(payload.slice(separator + LWA_PRELUDE_SEPARATOR_LENGTH)).toString(
    "utf-8",
  );
  try {
    const prelude = Buffer.from(payload.slice(0, separator)).toString("utf-8");
    const status = Number((JSON.parse(prelude) as { statusCode?: unknown }).statusCode);
    const isHttpStatus = Number.isInteger(status) && status >= 100 && status <= 599;
    return { status: isHttpStatus ? status : null, body };
  } catch {
    return { status: null, body };
  }
}
