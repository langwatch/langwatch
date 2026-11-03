/** The longest close reason: RFC 6455 §5.5 allows 125 bytes, less the 2-byte code. */
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Whether `code` may be sent in a close frame (RFC 6455 §7.4): 1005, 1006 and 1015 only describe
 * a close, and 1004 is reserved.
 */
export function isSendableCloseCode(code: number): boolean {
  if (code >= 3000 && code <= 4999) return true;
  return code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006;
}

/** A close one socket can pass on for another; `fallback` stands in for a code it cannot send. */
export function closeToPassOn(input: { code: number; reason: string; fallback: number }): {
  code: number;
  reason: string;
} {
  const code = isSendableCloseCode(input.code) ? input.code : input.fallback;
  let reason = input.reason;
  while (Buffer.byteLength(reason) > MAX_CLOSE_REASON_BYTES) reason = reason.slice(0, -1);
  return { code, reason };
}

/** A received frame's bytes as one Buffer, whichever shape the socket library handed it over in. */
export function frameBytes(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
