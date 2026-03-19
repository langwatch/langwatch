import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

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
    return toArrayBuffer(await gunzipAsync(Buffer.from(raw)));
  }

  if (encoding === "deflate") {
    return toArrayBuffer(await inflateAsync(Buffer.from(raw)));
  }

  if (encoding === "br") {
    return toArrayBuffer(await brotliDecompressAsync(Buffer.from(raw)));
  }

  throw new Error(`Unsupported Content-Encoding: ${encoding}`);
}
