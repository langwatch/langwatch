import type { Readable } from "node:stream";

/**
 * Raised when a stream exceeds the byte cap passed to {@link streamToBuffer}.
 * Callers that read untrusted object-store content pass a cap so a tampered or
 * unexpectedly large object cannot OOM the worker.
 */
export class StreamTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Stream exceeds ${maxBytes} bytes`);
    this.name = "StreamTooLargeError";
  }
}

/**
 * Buffers a Readable into a single Buffer.
 *
 * `maxBytes` bounds the total: once the accumulated size would exceed it, the
 * stream is destroyed and {@link StreamTooLargeError} is thrown rather than
 * letting an oversized object exhaust memory. Omit it only when the source is
 * already size-bounded upstream.
 */
export async function streamToBuffer(
  stream: Readable,
  maxBytes?: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer);
    if (maxBytes !== undefined) {
      total += buf.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new StreamTooLargeError(maxBytes);
      }
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
