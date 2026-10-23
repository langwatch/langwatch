/* Publishes the authored media a build references under content-hashed names, so a host can cache
   each file for a year, and rewrites every page and export to name them. Media nothing references
   stays out of the output; a few files keep stable names because something outside the pages
   (another site, the social card, a browser script) asks for them by name. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { FONT_SOURCE, SOCIAL_IMAGE } from "../features/discovery/compile/page-head.ts";
import { DOCS_URL, withBasePath } from "../lib/site-path.ts";
import { STATIC_DIRS } from "./document.ts";

/** Hex characters of a content hash in a published media name: `shot.<hash>.png`. */
export const HASH_LENGTH = 12;

/** Published files a host may cache forever: Vite's `assets/name-hash.ext` and hashed media. */
export const HASHED_FILE = new RegExp(
  `^/assets/[^/]+-[A-Za-z0-9_-]{8,}\\.[a-z0-9]+$|\\.[0-9a-f]{${HASH_LENGTH}}\\.[a-z0-9]+$`,
);

/* Brand marks are requested by name from browser scripts and the organisation's structured data;
   the favicon and the social card are fetched by name from outside the site. */
const STABLE = [/^\/logo\//, /^\/images\/logos\//, /^\/favicon\.svg$/];
const STABLE_FILES = ["/favicon.svg", SOCIAL_IMAGE];
const STABLE_DIRS = ["logo", "images/logos"];

const MEDIA_PATH = new RegExp(`^(?:/(?:${STATIC_DIRS.join("|")})|${FONT_SOURCE})/`);
const URL_ATTRIBUTE = /(\s(src|href|poster|srcset|imagesrcset)=")([^"]*)(")/gi;
const TEXT_URL =
  /(?<=[("'\s=]|^)(https:\/\/langwatch\.ai\/docs)?(\/(?:images|media)\/[^\s"'()<>[\]]+)/gm;

/** Whether a site path (without the base path) keeps its authored name in the output. */
export function isStableAsset({ sitePath }: { sitePath: string }) {
  return STABLE.some((pattern) => pattern.test(sitePath)) || sitePath === SOCIAL_IMAGE;
}

/** Whether a published site path names its content, so a host may cache it immutably. */
export function isHashedFile({ sitePath }: { sitePath: string }) {
  return HASHED_FILE.test(sitePath);
}

export function contentHash({ bytes }: { bytes: Uint8Array | string }) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH);
}

/** `images/a/shot.png` holding `bytes` is published as `images/a/shot.<hash>.png`. */
export function hashedName({ name, bytes }: { name: string; bytes: Uint8Array | string }) {
  const extension = path.posix.extname(name);
  return `${name.slice(0, name.length - extension.length)}.${contentHash({ bytes })}${extension}`;
}

/** The decoded site path of a local media URL under `basePath`, or null for anything else. */
export function localMediaPath({ url, basePath }: { url: string; basePath: string }) {
  if (!url.startsWith(`${basePath}/`) || url.startsWith("//")) return null;
  const sitePath = url.slice(basePath.length).split(/[?#]/)[0] ?? "";
  if (!MEDIA_PATH.test(sitePath)) return null;
  try {
    return decodeURIComponent(sitePath);
  } catch {
    return null;
  }
}

type Rename = (sitePath: string) => string | undefined;

function mapUrl({ url, basePath, rename }: { url: string; basePath: string; rename: Rename }) {
  const sitePath = localMediaPath({ url, basePath });
  const renamed = sitePath ? rename(sitePath) : undefined;
  if (!renamed) return url;
  const suffix = /[?#].*$/.exec(url)?.[0] ?? "";
  return withBasePath({ basePath, path: encodeURI(renamed) }) + suffix;
}

function mapSrcSet({
  value,
  basePath,
  rename,
}: {
  value: string;
  basePath: string;
  rename: Rename;
}) {
  return value
    .split(",")
    .map((candidate) => {
      const [url = "", ...descriptors] = candidate.trim().split(/\s+/);
      return [mapUrl({ url, basePath, rename }), ...descriptors].join(" ");
    })
    .join(", ");
}

/** Every local media site path a page names in a src, href, poster or srcset attribute. */
export function htmlMediaPaths({ html, basePath }: { html: string; basePath: string }) {
  const found = new Set<string>();
  rewriteHtmlMedia({
    html,
    basePath,
    rename: (sitePath) => {
      found.add(sitePath);
      return undefined;
    },
  });
  return found;
}

/** The page with each media URL attribute (every srcset candidate included) renamed. */
export function rewriteHtmlMedia({
  html,
  basePath,
  rename,
}: {
  html: string;
  basePath: string;
  rename: Rename;
}) {
  return html.replace(URL_ATTRIBUTE, (match, open: string, name: string, value: string, close) => {
    const decoded = value.replaceAll("&amp;", "&");
    const mapped = /srcset$/i.test(name)
      ? mapSrcSet({ value: decoded, basePath, rename })
      : mapUrl({ url: decoded, basePath, rename });
    return mapped === decoded ? match : `${open}${mapped.replaceAll("&", "&amp;")}${close}`;
  });
}

/** Every media site path an agent export names, as a public or root-relative address. */
export function textMediaPaths({ text }: { text: string }) {
  return new Set([...text.matchAll(TEXT_URL)].map((match) => match[2] ?? ""));
}

/** An agent export with each renamed media address made the public, hashed address. */
export function rewriteTextMedia({ text, rename }: { text: string; rename: Rename }) {
  return text.replace(TEXT_URL, (match, _origin, sitePath: string) => {
    const renamed = rename(sitePath);
    return renamed ? `${DOCS_URL}${encodeURI(renamed)}` : match;
  });
}

/**
 * Each web font's source path (as a page head preloads it) mapped to the hashed file Vite emitted
 * for the stylesheet's `@font-face`, so the preload and the face fetch one file.
 */
export function builtFontPaths({ fonts, assets }: { fonts: string[]; assets: string[] }) {
  const built = new Map<string, string>();
  for (const font of fonts) {
    const extension = path.posix.extname(font);
    const stem = font.slice(0, font.length - extension.length);
    const match = assets.find(
      (asset) =>
        asset.startsWith(`${stem}-`) &&
        asset.endsWith(extension) &&
        /^[A-Za-z0-9_-]{8}$/.test(asset.slice(stem.length + 1, asset.length - extension.length)),
    );
    if (match) built.set(`${FONT_SOURCE}/${font}`, `/assets/${match}`);
  }
  return built;
}

async function filesUnder({ root, directory }: { root: string; directory: string }) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  const entries = await readdir(absolute, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map(
      (entry) =>
        `/${path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")}`,
    );
}

/**
 * Publishes the media `pages` (HTML) and `texts` (agent exports) reference: `aliases` sends a path
 * to a file another pass published (a screenshot to its WebP), others go under their content hash.
 * Returns the rewritten pages and texts and each output name with the authored file to copy.
 */
export async function publishMedia({
  pages,
  texts,
  docsRoot,
  basePath,
  aliases = new Map(),
}: {
  pages: ReadonlyMap<string, string>;
  texts: ReadonlyMap<string, string>;
  docsRoot: string;
  basePath: string;
  aliases?: ReadonlyMap<string, string>;
}) {
  const referenced = new Set<string>();
  for (const html of new Set(pages.values()))
    for (const sitePath of htmlMediaPaths({ html, basePath })) referenced.add(sitePath);
  for (const text of texts.values())
    for (const sitePath of textMediaPaths({ text })) referenced.add(sitePath);
  const copies = new Map<string, string>();
  const renames = new Map<string, string>(aliases);
  const stable = [...STABLE_FILES];
  for (const directory of STABLE_DIRS)
    stable.push(...(await filesUnder({ root: docsRoot, directory })));
  for (const sitePath of [...referenced].toSorted()) {
    const file = path.join(docsRoot, sitePath);
    if (aliases.has(sitePath) || !file.startsWith(docsRoot + path.sep) || !existsSync(file))
      continue;
    if (isStableAsset({ sitePath })) stable.push(sitePath);
    else {
      const name = hashedName({ name: sitePath, bytes: await readFile(file) });
      renames.set(sitePath, name);
      copies.set(name.slice(1), file);
    }
  }
  for (const sitePath of stable) {
    const file = path.join(docsRoot, sitePath);
    if (existsSync(file)) copies.set(sitePath.slice(1), file);
  }
  const rename: Rename = (sitePath) => renames.get(sitePath);
  const rewrittenPages = new Map<string, string>();
  const byHtml = new Map<string, string>();
  for (const [target, html] of pages) {
    const page = byHtml.get(html) ?? rewriteHtmlMedia({ html, basePath, rename });
    byHtml.set(html, page);
    rewrittenPages.set(target, page);
  }
  const rewrittenTexts = new Map(
    [...texts].map(([name, text]) => [name, rewriteTextMedia({ text, rename })]),
  );
  return { pages: rewrittenPages, texts: rewrittenTexts, copies, renamed: renames.size };
}
