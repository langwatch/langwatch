import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

import { withBasePath } from "../lib/site-path.ts";
import {
  pageRasters,
  rewritePageImages,
  type ImageVariant,
  type ImageVariants,
} from "./page-images.ts";

/* Twice the 840px article column: sharp on a 2x screen, a fraction of a 3,000px capture. */
const MAX_WIDTH = 1680;
const VARIANT_DIR = "media/optimized";
const CONCURRENT_IMAGES = 4;
const ENCODINGS = [
  {
    extension: "avif",
    type: "image/avif",
    encode: (image: Sharp) => image.avif({ quality: 60, effort: 4, chromaSubsampling: "4:4:4" }),
  },
  {
    extension: "webp",
    type: "image/webp",
    encode: (image: Sharp) => image.webp({ quality: 80, effort: 4, smartSubsample: true }),
  },
] as const;
/* Part of every cache key: changing an encoder setting re-encodes every image. */
const SETTINGS = `v1 ${MAX_WIDTH} avif q60 444 e4; webp q80 smart e4`;

type Encoded = { name: string; type: string; width: number; bytes: Buffer };

async function cached({ file, format }: { file: string; format: string }) {
  try {
    const bytes = await readFile(file);
    const meta = await sharp(bytes).metadata();
    return meta.format === format || (format === "avif" && meta.format === "heif") ? bytes : null;
  } catch {
    return null;
  }
}

async function encodeOnce({
  input,
  encoding,
  width,
  digest,
  cacheDir,
}: {
  input: Buffer;
  encoding: (typeof ENCODINGS)[number];
  width: number;
  digest: string;
  cacheDir: string | null;
}) {
  const file = cacheDir ? path.join(cacheDir, `${digest}.${encoding.extension}`) : null;
  const hit = file ? await cached({ file, format: encoding.extension }) : null;
  if (hit) return hit;
  const bytes = await encoding
    .encode(sharp(input).resize({ width, withoutEnlargement: true }))
    .toBuffer();
  if (file && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(`${file}.${process.pid}.partial`, bytes);
    await rename(`${file}.${process.pid}.partial`, file);
  }
  return bytes;
}

/**
 * An image's modern encodings no larger than the original, each read from `cacheDir` when an
 * earlier build already encoded the same bytes. Animated and unreadable images get none.
 */
export async function encodeImage({
  input,
  cacheDir,
}: {
  input: Buffer;
  cacheDir: string | null;
}): Promise<Encoded[]> {
  const digest = createHash("sha256").update(SETTINGS).update(input).digest("hex");
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return [];
  }
  if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) return [];
  const width = Math.min(meta.width, MAX_WIDTH);
  const encoded: Encoded[] = [];
  for (const encoding of ENCODINGS) {
    const bytes = await encodeOnce({ input, encoding, width, digest, cacheDir });
    if (bytes.length < input.length) {
      const name = `${VARIANT_DIR}/${digest.slice(0, 20)}-${width}.${encoding.extension}`;
      encoded.push({ name, type: encoding.type, width, bytes });
    }
  }
  return encoded;
}

/**
 * Encodes every local raster the pages' articles show and rewrites each page to offer the
 * encodings in a `<picture>`, preloading the first image above the fold. Returns the rewritten
 * pages and the encoded files to publish.
 */
export async function optimisePageImages({
  pages,
  docsRoot,
  basePath,
  cacheDir,
}: {
  pages: ReadonlyMap<string, string>;
  docsRoot: string;
  basePath: string;
  cacheDir: string | null;
}) {
  const sources = [
    ...new Set([...new Set(pages.values())].flatMap((html) => pageRasters({ html, basePath }))),
  ];
  const variants = new Map<string, ImageVariant[]>();
  const files = new Map<string, Buffer>();
  let next = 0;
  async function drain() {
    while (next < sources.length) {
      const sitePath = sources[next] ?? "";
      next += 1;
      const file = path.join(docsRoot, sitePath);
      if (!file.startsWith(docsRoot + path.sep) || !existsSync(file)) continue;
      const encoded = await encodeImage({ input: await readFile(file), cacheDir });
      for (const { name, bytes } of encoded) files.set(name, bytes);
      if (encoded.length > 0)
        variants.set(
          sitePath,
          encoded.map(({ name, type, width }) => ({
            type,
            width,
            path: withBasePath({ basePath, path: `/${name}` }),
          })),
        );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENT_IMAGES }, drain));
  const known: ImageVariants = variants;
  const byPage = new Map<string, string>();
  const rewritten = new Map<string, string>();
  for (const [target, html] of pages) {
    const page = byPage.get(html) ?? rewritePageImages({ html, variants: known, basePath });
    byPage.set(html, page);
    rewritten.set(target, page);
  }
  return { pages: rewritten, files, sources: sources.length };
}
