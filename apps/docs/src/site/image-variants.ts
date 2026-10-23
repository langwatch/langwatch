import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

import { withBasePath } from "../lib/site-path.ts";
import { hashedName } from "./hashed-assets.ts";
import { pruneCache, writeAtomically } from "./media-cache.ts";
import {
  fallbackVariant,
  pageRasters,
  rewritePageImages,
  type ImageVariant,
  type ImageVariants,
} from "./page-images.ts";

/* The 840px article column at 1x and 2x: a phone takes the smaller, a 2x screen the larger, and a
   3,000px capture never ships at full size. */
const COLUMN_WIDTH = 840;
const MAX_WIDTH = 2 * COLUMN_WIDTH;
const CONCURRENT_IMAGES = 4;
/* Screenshots are flat UI and text: these qualities keep text edges clean (SSIM above 0.98 on a
   sample of the docs' own captures) at about a seventh of the PNG's size. */
const ENCODINGS = [
  {
    extension: "avif",
    type: "image/avif",
    encode: (image: Sharp) => image.avif({ quality: 50, effort: 4, chromaSubsampling: "4:4:4" }),
  },
  {
    extension: "webp",
    type: "image/webp",
    encode: (image: Sharp) => image.webp({ quality: 76, effort: 6, smartSubsample: true }),
  },
] as const;
/* Part of every cache key: changing an encoder setting re-encodes every image. */
const SETTINGS = `v2 ${COLUMN_WIDTH} ${MAX_WIDTH} avif q50 444 e4; webp q76 smart e6; oriented`;

/** The widths an image of `width` is published at: the column at 1x when it is much smaller. */
export function variantWidths({ width }: { width: number }) {
  const largest = Math.min(width, MAX_WIDTH);
  return largest * 0.8 > COLUMN_WIDTH ? [COLUMN_WIDTH, largest] : [largest];
}

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
  used,
}: {
  input: Buffer;
  encoding: (typeof ENCODINGS)[number];
  width: number;
  digest: string;
  cacheDir: string | null;
  used?: Set<string>;
}) {
  const name = `${digest}-${width}.${encoding.extension}`;
  used?.add(name);
  const file = cacheDir ? path.join(cacheDir, name) : null;
  const hit = file ? await cached({ file, format: encoding.extension }) : null;
  if (hit) return hit;
  const bytes = await encoding
    .encode(sharp(input).rotate().resize({ width, withoutEnlargement: true }))
    .toBuffer();
  if (file) await writeAtomically({ file, bytes });
  return bytes;
}

/**
 * An image's modern encodings per published width, each smaller than the original, without its
 * metadata, named by content beside it (`images/a/shot-840.<hash>.webp`) and read from `cacheDir`
 * when a build already encoded the same bytes. Animated and unreadable images get none.
 */
export async function encodeImage({
  input,
  sitePath,
  cacheDir,
  used,
}: {
  input: Buffer;
  sitePath: string;
  cacheDir: string | null;
  /** Collects the cache entries this build read or wrote, for pruning the rest. */
  used?: Set<string>;
}): Promise<Encoded[]> {
  const digest = createHash("sha256").update(SETTINGS).update(input).digest("hex");
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return [];
  }
  if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) return [];
  const stem = sitePath.replace(/^\//, "").replace(/\.[^./]+$/, "");
  const encoded: Encoded[] = [];
  for (const encoding of ENCODINGS) {
    for (const width of variantWidths({ width: meta.width })) {
      const bytes = await encodeOnce({ input, encoding, width, digest, cacheDir, used });
      if (bytes.length >= input.length) continue;
      const name = hashedName({ name: `${stem}-${width}.${encoding.extension}`, bytes });
      encoded.push({ name, type: encoding.type, width, bytes });
    }
  }
  return encoded;
}

/**
 * Encodes every local raster the pages' articles show and rewrites each page to offer the
 * encodings in a `<picture>`, preloading the first image above the fold. Returns the rewritten
 * pages, the encoded files to publish and, per authored path, the encoding that replaces it.
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
  const aliases = new Map<string, string>();
  const used = new Set<string>();
  let next = 0;
  async function drain() {
    while (next < sources.length) {
      const sitePath = sources[next] ?? "";
      next += 1;
      const file = path.join(docsRoot, sitePath);
      if (!file.startsWith(docsRoot + path.sep) || !existsSync(file)) continue;
      const encoded = await encodeImage({ input: await readFile(file), sitePath, cacheDir, used });
      for (const { name, bytes } of encoded) files.set(name, bytes);
      const fallback = fallbackVariant({ variants: encoded });
      if (fallback) aliases.set(sitePath, `/${fallback.name}`);
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
  await pruneCache({ directory: cacheDir, keep: used });
  const known: ImageVariants = variants;
  const byPage = new Map<string, string>();
  const rewritten = new Map<string, string>();
  for (const [target, html] of pages) {
    const page = byPage.get(html) ?? rewritePageImages({ html, variants: known, basePath });
    byPage.set(html, page);
    rewritten.set(target, page);
  }
  return { pages: rewritten, files, aliases, sources: sources.length };
}
