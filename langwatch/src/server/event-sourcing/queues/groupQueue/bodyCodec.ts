import { promisify } from "node:util";
import { gunzip, gzip, zstdCompress, zstdDecompress } from "node:zlib";

import { Packr } from "msgpackr";

import { MAX_BLOB_BYTES } from "./blobConstants";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);

/**
 * Cap decompression output at the encode ceiling (ADR-030 §1) so a corrupt or
 * tampered blob can't OOM the worker. Both codecs throw past the limit; decode
 * lets that propagate to the missing-blob fail-safe.
 */
const GUNZIP_OPTS = { maxOutputLength: MAX_BLOB_BYTES };
const ZSTD_OPTS = { maxOutputLength: MAX_BLOB_BYTES };

/**
 * msgpackr's record extension rewrites repeated object shapes into a shared
 * structure table. That table is stateful across packs, which would make the
 * bytes for a given payload depend on what the encoder packed *before* it —
 * fatal for content-addressed dedup, where identical payloads must produce
 * identical bytes on every pod. `useRecords: false` keeps each pack
 * self-contained and deterministic.
 */
const packr = new Packr({ useRecords: false, structuredClone: false });

/** How a payload was turned into bytes. */
export type PayloadCodec = "json" | "msgpack";
/** How those bytes were compressed. */
export type CompressionCodec = "none" | "gzip" | "zstd";

/**
 * msgpack pays off only on large payloads. Below this, `JSON.stringify` beats
 * `msgpackr.pack` outright (measured ~1.7-1.9x on 1.5-6KB job bodies): our
 * payloads are dominated by long UTF-8 strings — LLM prompts, completions, RAG
 * contexts — which msgpack stores essentially the way JSON does, so there is no
 * structural redundancy for it to win back, while V8's JSON fast path is hard to
 * beat on exactly that shape. Above the threshold msgpack's faster *decode*
 * (2-3x) dominates and it wins.
 */
export const MSGPACK_MIN_BYTES = 100 * 1024;

/**
 * Magic bytes. Compression is detected by sniffing rather than by trusting the
 * envelope header, so blobs written before this change — already sitting in S3
 * under a content hash — keep decoding with no migration and no dual-write.
 */
const GZIP_MAGIC = [0x1f, 0x8b];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

const startsWith = (buf: Buffer, magic: number[]): boolean =>
  buf.length >= magic.length && magic.every((byte, i) => buf[i] === byte);

export function detectCompression(buf: Buffer): CompressionCodec {
  if (startsWith(buf, GZIP_MAGIC)) return "gzip";
  if (startsWith(buf, ZSTD_MAGIC)) return "zstd";
  return "none";
}

export async function compress(
  data: Buffer | string,
  codec: CompressionCodec,
): Promise<Buffer> {
  switch (codec) {
    case "gzip":
      return await gzipAsync(data);
    case "zstd":
      return await zstdCompressAsync(data);
    case "none":
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
}

/** Decompresses by sniffing the payload, so gzip and zstd blobs coexist. */
export async function decompress(buf: Buffer): Promise<Buffer> {
  switch (detectCompression(buf)) {
    case "gzip":
      return await gunzipAsync(buf, GUNZIP_OPTS);
    case "zstd":
      return await zstdDecompressAsync(buf, ZSTD_OPTS);
    case "none":
      return buf;
  }
}

/**
 * Serializes a payload, choosing msgpack only above {@link MSGPACK_MIN_BYTES}.
 *
 * Returns the codec alongside the bytes because the caller must fold it into the
 * content hash — see {@link contentHashSource}.
 */
export function encodePayload(
  payload: Record<string, unknown>,
  { msgpackEnabled }: { msgpackEnabled: boolean },
): { bytes: Buffer; codec: PayloadCodec; json: string | null } {
  const json = JSON.stringify(payload);
  const jsonBytes = Buffer.byteLength(json);

  if (!msgpackEnabled || jsonBytes < MSGPACK_MIN_BYTES) {
    return { bytes: Buffer.from(json), codec: "json", json };
  }

  return { bytes: packr.pack(payload), codec: "msgpack", json };
}

/**
 * Deserializes a payload by sniffing the leading byte.
 *
 * JSON object/array bodies begin with `{` (0x7b) or `[` (0x5b); msgpack encodes a
 * top-level map as fixmap (0x80-0x8f), map16 (0xde) or map32 (0xdf). The ranges
 * are disjoint, so this is unambiguous for the shapes we actually store — and
 * sniffing means we never trust a header that could disagree with the bytes.
 */
export function decodePayload(buf: Buffer): Record<string, unknown> {
  const first = buf[0];
  const isMsgpack =
    first !== undefined &&
    ((first >= 0x80 && first <= 0x8f) || first === 0xde || first === 0xdf);

  return isMsgpack
    ? (packr.unpack(buf) as Record<string, unknown>)
    : (JSON.parse(buf.toString("utf-8")) as Record<string, unknown>);
}

/**
 * The dedup key for a content-addressed blob.
 *
 * The codec MUST be part of the hash. Blobs are content-addressed, so a hash
 * collision means "reuse the stored copy" — and during a rollout one pod may
 * encode a payload as JSON while another encodes the same payload as msgpack. If
 * both hashed only the payload they would land on the same key with *different
 * bytes*, and the second writer would silently dedup onto the first, handing a
 * reader bytes in a codec it wasn't expecting. Folding the codec in keeps the two
 * representations on separate keys, at the cost of storing both during the
 * transition.
 */
export function contentHashSource({
  codec,
  json,
  bytes,
}: {
  codec: PayloadCodec;
  json: string | null;
  bytes: Buffer;
}): string | Buffer {
  // Hash the raw payload representation, never the compressed output: gzip/zstd
  // determinism varies with library version and level (ADR-030 §1).
  return codec === "json" && json !== null ? `json:${json}` : bytes;
}
