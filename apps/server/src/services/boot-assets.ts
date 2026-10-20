import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type http from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream";

/** The browser bundle's content-hashed assets, as the api serves them (browser-bundle.ts). */
export const ASSET_PREFIX = "/assets/";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** The entry scripts and styles the app's index.html loads first, so a boot page can fetch them. */
export function readEntryAssets({ clientDir }: { clientDir: string }): string[] {
  const indexFile = join(clientDir, "index.html");
  if (!existsSync(indexFile)) return [];
  const html = readFileSync(indexFile, "utf8");
  const entries = html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g);
  return [...new Set([...entries].map((match) => match[1] as string))];
}

/**
 * Answers one hashed asset from `clientDir`, cached for good like the api does; false when the
 * path is not a file under the assets directory, so the caller answers it as it would anyway.
 */
export function serveHashedAsset({
  clientDir,
  pathname,
  res,
}: {
  clientDir: string;
  pathname: string;
  res: http.ServerResponse;
}): boolean {
  const assetsDir = join(clientDir, "assets");
  const file = normalize(join(clientDir, pathname));
  if (!file.startsWith(assetsDir + sep)) return false;
  if (!isFile(file)) return false;
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": IMMUTABLE_CACHE,
  });
  // A read that fails mid-way ends this response, never the process holding the public port.
  pipeline(createReadStream(file), res, () => undefined);
  return true;
}

/** Whether `file` is a file; a stat failure (ENOTDIR, EACCES) reads as no. */
function isFile(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}
