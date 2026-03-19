import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { NextRequest } from "next/server";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Reads the request body, decompressing based on Content-Encoding.
 * Supports gzip (OTEL standard), deflate, and brotli.
 * Throws on unsupported encodings to surface misconfiguration early.
 */
export async function readBody(req: NextRequest): Promise<ArrayBuffer> {
  const raw = await req.arrayBuffer();
  const encoding = req.headers.get("content-encoding");

  if (!encoding || encoding === "identity") {
    return raw;
  }

  if (encoding === "gzip") {
    return toArrayBuffer(gunzipSync(Buffer.from(raw)));
  }

  if (encoding === "deflate") {
    return toArrayBuffer(inflateSync(Buffer.from(raw)));
  }

  if (encoding === "br") {
    return toArrayBuffer(brotliDecompressSync(Buffer.from(raw)));
  }

  throw new Error(`Unsupported Content-Encoding: ${encoding}`);
}
