import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { DoorHandler } from "./server.ts";

/** The built browser application, as the process hands it to its own door. */
export type BrowserBundle = Readonly<{
  /** Where the built bundle is. Absent from disk, the door answers nothing. */
  directory: string;
  /**
   * Injected at the START of the shell's `<head>`: this deployment's public
   * configuration, ahead of the bundle's own scripts, which read it.
   */
  head?: string;
  /** Sent with every served file — the deployment's own security headers. */
  headers?: Readonly<Record<string, string>>;
}>;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".json": "application/json",
  ".mjs": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NO_STORE_CACHE = "no-store, max-age=0";
// The shell is revalidated on every load so a reload after a deploy picks up
// the new chunk hashes; a cached shell would reload into hashes that are gone.
const HTML_REVALIDATE_CACHE = "no-cache";

/** Where the bundle's content-hashed assets live, and are cached forever. */
const ASSET_PREFIX = "/assets/";

/**
 * The built browser application on the process's one door, answering LAST so
 * it can shadow no declared route: a path no transport claimed is the single
 * page application's to route, and only a missing asset is a 404.
 */
export function browserBundleDoor(bundle: BrowserBundle): DoorHandler {
  return {
    name: "browser bundle",
    // Far behind every transport: this is the fallback, not a route.
    order: 1_000,
    handle: (request, response) => serveBundle({ bundle, request, response }),
  };
}

function serveBundle({
  bundle,
  request,
  response,
}: {
  bundle: BrowserBundle;
  request: IncomingMessage;
  response: ServerResponse;
}): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  // The pathname alone, parsed against a fixed base: a caller-supplied Host
  // header never takes part in deciding which file is read.
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const relative = path.normalize(pathname.slice(1));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
    return true;
  }

  const file = path.join(bundle.directory, relative);
  if (path.extname(file) === ".html") {
    if (serveShell({ bundle, file, response })) return true;
  } else if (serveFile({ bundle, file, pathname, response })) {
    return true;
  }

  // A missing hashed asset is gone, not a route: answering the shell would
  // hand a script tag an HTML body and break the page with a parse error.
  if (pathname.startsWith(ASSET_PREFIX)) {
    response
      .writeHead(404, { "Content-Type": "text/plain", "Cache-Control": NO_STORE_CACHE })
      .end("Not Found");
    return true;
  }

  return serveShell({ bundle, file: path.join(bundle.directory, "index.html"), response });
}

/**
 * Opens and streams one file in a single step: opening first and reading from
 * the descriptor leaves no window for the path to change underneath it.
 */
function serveFile({
  bundle,
  file,
  pathname,
  response,
}: {
  bundle: BrowserBundle;
  file: string;
  pathname: string;
  response: ServerResponse;
}): boolean {
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, "r");
  } catch {
    return false;
  }

  if (!fs.fstatSync(descriptor).isFile()) {
    fs.closeSync(descriptor);
    return false;
  }

  response.writeHead(200, {
    ...bundle.headers,
    "Content-Type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
    ...(pathname.startsWith(ASSET_PREFIX) ? { "Cache-Control": IMMUTABLE_CACHE } : {}),
  });

  const stream = fs.createReadStream("", { fd: descriptor });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
  return true;
}

/** The shell, with this deployment's configuration injected into its head. */
function serveShell({
  bundle,
  file,
  response,
}: {
  bundle: BrowserBundle;
  file: string;
  response: ServerResponse;
}): boolean {
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, "r");
  } catch {
    return false;
  }

  try {
    if (!fs.fstatSync(descriptor).isFile()) return false;
    const html = fs.readFileSync(descriptor, "utf8");
    response
      .writeHead(200, {
        ...bundle.headers,
        "Content-Type": "text/html",
        "Cache-Control": HTML_REVALIDATE_CACHE,
      })
      .end(injectHead({ html, head: bundle.head }));
    return true;
  } finally {
    fs.closeSync(descriptor);
  }
}

function injectHead({ html, head }: { html: string; head: string | undefined }): string {
  if (head === undefined || head === "") return html;
  const opening = /<head[^>]*>/i.exec(html);
  if (opening === null) {
    throw new Error("The browser bundle's shell has no <head> to inject this deployment into.");
  }
  const at = opening.index + opening[0].length;

  return `${html.slice(0, at)}${head}${html.slice(at)}`;
}
