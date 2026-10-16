import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/* Brotli at its highest quality takes seconds on the index, so each encoding is cached by the
   digest of what it encodes and checked by decoding it again before it is reused. */
const ENCODINGS = [
  {
    extension: "br",
    encode: (input: Buffer) =>
      brotliCompress(input, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.length,
        },
      }),
    decode: (encoded: Buffer) => zlib.brotliDecompressSync(encoded),
  },
  {
    extension: "gz",
    encode: (input: Buffer) => gzip(input, { level: zlib.constants.Z_BEST_COMPRESSION }),
    decode: (encoded: Buffer) => zlib.gunzipSync(encoded),
  },
] as const;

type Encoding = (typeof ENCODINGS)[number];

async function cachedEncoding({
  file,
  input,
  encoding,
}: {
  file: string;
  input: Buffer;
  encoding: Encoding;
}) {
  try {
    const encoded = await readFile(file);
    return encoding.decode(encoded).equals(input) ? encoded : null;
  } catch {
    return null;
  }
}

async function encodeOnce({
  input,
  encoding,
  cacheDir,
}: {
  input: Buffer;
  encoding: Encoding;
  cacheDir: string | null;
}) {
  const digest = createHash("sha256").update(input).digest("hex");
  const file = cacheDir ? path.join(cacheDir, `${digest}.${encoding.extension}`) : null;
  const cached = file ? await cachedEncoding({ file, input, encoding }) : null;
  if (cached) return cached;
  const encoded = await encoding.encode(input);
  if (file && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(`${file}.${process.pid}.partial`, encoded);
    await rename(`${file}.${process.pid}.partial`, file);
  }
  return encoded;
}

/**
 * The search index precompressed beside itself (`.br`, `.gz`), for a static host or the local
 * mount to serve by Accept-Encoding: the one large text file a reader fetches whole.
 */
export async function compressedSearchIndex({
  json,
  cacheDir,
}: {
  json: string;
  cacheDir: string | null;
}): Promise<[string, Uint8Array][]> {
  const input = Buffer.from(json);
  return Promise.all(
    ENCODINGS.map(async (encoding): Promise<[string, Uint8Array]> => [
      `search-index.json.${encoding.extension}`,
      await encodeOnce({ input, encoding, cacheDir }),
    ]),
  );
}
