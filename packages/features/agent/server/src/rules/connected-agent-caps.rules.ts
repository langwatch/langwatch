/**
 * What a connected agent's reply is allowed to weigh.
 *
 * Server-side rather than contract: the measurement is `Buffer.byteLength`,
 * and the caps are only ever enforced on the way in.
 */

/** The size of a JSON value on the wire, in bytes. */
export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

/**
 * The cap a result breaks, or nothing when it fits.
 */
export function resultCapViolation({
  output,
  session,
  caps,
}: {
  output: unknown;
  session: unknown;
  caps: { resultBytes: number; sessionBytes: number };
}): {
  what: "result" | "session";
  sizeBytes: number;
  limitBytes: number;
} | null {
  const sessionBytes = session === undefined ? 0 : jsonByteLength(session);
  if (session !== undefined && sessionBytes > caps.sessionBytes) {
    return {
      what: "session",
      sizeBytes: sessionBytes,
      limitBytes: caps.sessionBytes,
    };
  }

  const resultBytes = jsonByteLength(output) + sessionBytes;
  if (resultBytes > caps.resultBytes) {
    return {
      what: "result",
      sizeBytes: resultBytes,
      limitBytes: caps.resultBytes,
    };
  }

  return null;
}
