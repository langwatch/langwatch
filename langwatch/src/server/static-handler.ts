import fs from "fs";
import type { ServerResponse } from "http";
import path from "path";

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
// The HTML shell must always be revalidated so a post-deploy reload picks up
// the new chunk hashes. Vite calls this out as a prerequisite for
// `vite:preloadError` recovery (see src/utils/chunkReload.ts): a cached shell
// would reload straight back into the removed hashes and strand the user.
const HTML_REVALIDATE_CACHE = "no-cache";

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
  if (tryServeFile({ res, filePath: staticPath, pathname })) {
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
  return tryServeSpaFallback({ res, indexHtmlPath: indexHtml });
}

/**
 * Open + stream a static file in one step, avoiding the TOCTOU race between
 * existsSync and createReadStream. Returns false when the file doesn't exist
 * or isn't a regular file so the caller can fall through.
 */
function tryServeFile({
  res,
  filePath,
  pathname,
}: {
  res: ServerResponse;
  filePath: string;
  pathname: string;
}): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return false;
  }

  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) {
    fs.closeSync(fd);
    return false;
  }

  const ext = path.extname(filePath);
  res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
  if (pathname.startsWith("/assets/")) {
    res.setHeader("Cache-Control", IMMUTABLE_CACHE);
  } else if (ext === ".html") {
    res.setHeader("Cache-Control", HTML_REVALIDATE_CACHE);
  }

  pipeWithErrorHandling({ stream: fs.createReadStream("", { fd }), res });
  return true;
}

/**
 * Serve the SPA shell (index.html) as a fallback for non-asset routes.
 * Returns false only when index.html itself doesn't exist.
 */
function tryServeSpaFallback({
  res,
  indexHtmlPath,
}: {
  res: ServerResponse;
  indexHtmlPath: string;
}): boolean {
  let fd: number;
  try {
    fd = fs.openSync(indexHtmlPath, "r");
  } catch {
    return false;
  }

  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", HTML_REVALIDATE_CACHE);
  pipeWithErrorHandling({ stream: fs.createReadStream("", { fd }), res });
  return true;
}

/**
 * Pipe a readable stream to the response with error handling. On stream
 * error, respond with 500 if headers haven't been sent yet, otherwise
 * just destroy the connection cleanly.
 */
function pipeWithErrorHandling({
  stream,
  res,
}: {
  stream: fs.ReadStream;
  res: ServerResponse;
}): void {
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Cache-Control", NO_STORE_CACHE);
      res.end("Internal Server Error");
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}
