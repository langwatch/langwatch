import fs from "fs";
import path from "path";
import type { ServerResponse } from "http";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NO_STORE_CACHE = "no-store, max-age=0";

/**
 * Production static file + SPA fallback handler.
 *
 * Returns true when the response was written (caller should not write further).
 * Returns false only when there is no index.html to fall back to (caller decides
 * how to 404).
 *
 * Why missing /assets/* returns 404 instead of falling through to index.html:
 * Vite hashes asset filenames per build, so chunk URLs from a previous deploy
 * point to files that no longer exist. If we returned the SPA shell with a 200
 * status, a CDN with a "cache everything under /assets/* immutably" rule would
 * cache the HTML response under the JS URL — every subsequent visitor then hits
 * a strict-MIME violation in the browser, even after a roll-forward, until the
 * cache is manually purged.
 */
export function serveStaticOrFallback({
  res,
  pathname,
  clientDistDir,
}: {
  res: ServerResponse;
  pathname: string;
  clientDistDir: string;
}): boolean {
  const normalizedRelative = path.normalize(pathname.slice(1));
  if (
    normalizedRelative.startsWith("..") ||
    path.isAbsolute(normalizedRelative)
  ) {
    res.statusCode = 400;
    res.end("Bad Request");
    return true;
  }

  const staticPath = path.join(clientDistDir, normalizedRelative);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    serveStaticFile(res, staticPath, pathname);
    return true;
  }

  if (pathname.startsWith("/assets/")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    res.end("Not Found");
    return true;
  }

  const indexHtml = path.join(clientDistDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    res.setHeader("Content-Type", "text/html");
    fs.createReadStream(indexHtml).pipe(res);
    return true;
  }

  return false;
}

function serveStaticFile(
  res: ServerResponse,
  filePath: string,
  pathname: string
) {
  const ext = path.extname(filePath);
  res.setHeader(
    "Content-Type",
    MIME_TYPES[ext] ?? "application/octet-stream"
  );
  if (pathname.startsWith("/assets/")) {
    res.setHeader("Cache-Control", IMMUTABLE_CACHE);
  }
  fs.createReadStream(filePath).pipe(res);
}
