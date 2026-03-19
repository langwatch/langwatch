import { gunzipSync, inflateSync } from "node:zlib";
import type { NextRequest } from "next/server";

/**
 * Reads the request body, decompressing it if Content-Encoding is gzip or deflate.
 * OTEL SDKs send compressed bodies when `compression: true` is configured.
 */
export async function readBody(req: NextRequest): Promise<ArrayBuffer> {
  const raw = await req.arrayBuffer();
  const encoding = req.headers.get("content-encoding");

  if (encoding === "gzip") {
    const buf = gunzipSync(Buffer.from(raw));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  if (encoding === "deflate") {
    const buf = inflateSync(Buffer.from(raw));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  return raw;
}
