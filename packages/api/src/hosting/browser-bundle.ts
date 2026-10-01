/**
 * The built browser application, served off the same listener as the API:
 * hashed assets first and immutable, the shell last with this deployment's
 * head config injected. The session is READ on document requests only (§4).
 */
import fs from "node:fs";
import path from "node:path";

import type { SecurityHeaders } from "../policy/security-headers.ts";
import type { SessionCaller, SessionReader } from "../rest/credential.ts";
import type { HttpFailureAnswer, HttpHandler } from "./http-mux.ts";

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
 * What this deployment injects into the shell's head, knowing who is asking.
 * Every caller answers the same thing for everyone today; the parameter is what
 * makes a session-aware projection a change of this function alone.
 */
export type PublicConfigHead = (caller: SessionCaller | null) => string;

export type DocumentAccess = (
  request: Request,
  caller: SessionCaller | null,
) => void | Response | Promise<void | Response>;

export class BrowserBundle {
  static create(options: {
    /** Where the built bundle is. Absent from disk, every request answers 404. */
    dist: string | undefined;
    /** Injected at the START of the shell's head, ahead of the bundle's scripts. */
    publicConfig: PublicConfigHead;
    /** Read on document requests only. Never on a hashed asset. */
    sessionReader: SessionReader;
    /** The floor plus the document policy this deployment composed. */
    security: SecurityHeaders;
    authorizeDocument?: DocumentAccess;
  }): BrowserBundle {
    return new BrowserBundle(options);
  }

  private readonly dist: string | undefined;
  private readonly publicConfig: PublicConfigHead;
  private readonly sessionReader: SessionReader;
  private readonly security: SecurityHeaders;
  private readonly authorizeDocument: DocumentAccess | undefined;

  private constructor({
    dist,
    publicConfig,
    sessionReader,
    security,
    authorizeDocument,
  }: {
    dist: string | undefined;
    publicConfig: PublicConfigHead;
    sessionReader: SessionReader;
    security: SecurityHeaders;
    authorizeDocument?: DocumentAccess;
  }) {
    this.dist = dist;
    this.publicConfig = publicConfig;
    this.sessionReader = sessionReader;
    this.security = security;
    this.authorizeDocument = authorizeDocument;
  }

  /** Whether this deployment carries a build at all. */
  get serves(): boolean {
    return this.dist !== void 0;
  }

  fetch = (request: Request): Promise<Response> => this.answer(request);

  /** This application as a route handler, for the mux that answers with it. */
  get handler(): HttpHandler {
    return (request) => this.answer(request);
  }

  /**
   * The page a failure is shown on. Self-contained by construction: inline
   * styles and no asset reference at all, because the bundle machinery is
   * exactly what may have failed. The shell is never re-attempted.
   */
  get onFailure(): HttpFailureAnswer {
    return (failure) => errorPage(failure);
  }

  async answer(request: Request): Promise<Response> {
    const dist = this.dist;

    if (!dist) return text(404, "Not Found");

    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method Not Allowed");
    }

    const { pathname } = new URL(request.url);
    const relative = path.normalize(pathname.slice(1));

    if (relative.startsWith("..") || path.isAbsolute(relative)) return text(400, "Bad Request");

    const file = path.join(dist, relative);

    if (path.extname(file) === ".html" && !pathname.startsWith(ASSET_PREFIX)) {
      const shell = await this.shell(file, request);

      if (shell) return shell;
    } else {
      const asset = await this.asset(file, pathname);

      if (asset) return asset;
    }

    // A missing hashed asset is gone, not a route: answering the shell would
    // hand a script tag an HTML body and break the page with a parse error.
    if (pathname.startsWith(ASSET_PREFIX)) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain", "Cache-Control": NO_STORE_CACHE },
      });
    }

    // Last: a path no asset and no API family claimed is the single-page
    // application's own to route, so it gets the shell.
    return (await this.shell(path.join(dist, "index.html"), request)) ?? text(404, "Not Found");
  }

  /**
   * Opens one file as a lazily-read blob: opened first and read from the
   * handle, so there is no window for the path to change underneath it.
   */
  private async asset(file: string, pathname: string): Promise<Response | undefined> {
    let body: Blob;

    try {
      if (!fs.statSync(file).isFile()) return void 0;

      body = await fs.openAsBlob(file);
    } catch {
      // Not a readable file on disk — this path's ordinary "try the next answer".
      return void 0;
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...this.security.headers,
        "Content-Type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
        ...(pathname.startsWith(ASSET_PREFIX) ? { "Cache-Control": IMMUTABLE_CACHE } : {}),
      },
    });
  }

  /** The shell, with this deployment's configuration for whoever is asking. */
  private async shell(file: string, request: Request): Promise<Response | undefined> {
    let html: string;

    try {
      const descriptor = fs.openSync(file, "r");

      try {
        if (!fs.fstatSync(descriptor).isFile()) return void 0;

        html = fs.readFileSync(descriptor, "utf8");
      } finally {
        fs.closeSync(descriptor);
      }
    } catch {
      // Not on disk, which is this path's ordinary "try the next answer".
      return void 0;
    }

    const caller = await this.sessionReader.read(request);
    const refusal = await this.authorizeDocument?.(request, caller);
    if (refusal) return refusal;

    return new Response(injectHead(html, this.publicConfig(caller)), {
      status: 200,
      headers: {
        ...this.security.headers,
        "Content-Type": "text/html",
        "Cache-Control": HTML_REVALIDATE_CACHE,
      },
    });
  }
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function injectHead(html: string, head: string): string {
  if (head === "") return html;

  const opening = /<head[^>]*>/i.exec(html);

  if (opening === null) {
    throw new Error("The browser bundle's shell has no <head> to inject this deployment into.");
  }

  const at = opening.index + opening[0].length;

  return `${html.slice(0, at)}${head}${html.slice(at)}`;
}

/**
 * The standard error page. Everything it needs is in the document: a failure
 * here may well be the asset pipeline, so a stylesheet or a script reference
 * would be one more thing that cannot load.
 */
function errorPage(failure: unknown): Response {
  const traceId = traceIdOf(failure);

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Something went wrong</title></head>` +
      `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
      `font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a202c;background:#f7fafc">` +
      `<main style="max-width:32rem;padding:2rem;text-align:center">` +
      `<h1 style="margin:0 0 .5rem;font-size:1.5rem;font-weight:600">Something went wrong</h1>` +
      `<p style="margin:0 0 1rem;color:#4a5568">This page could not be loaded. Trying again often works.</p>` +
      (traceId
        ? `<p style="margin:0;font-size:.875rem;color:#718096">Reference: <code>${escapeHtml(traceId)}</code></p>`
        : "") +
      `</main></body></html>`,
    { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** The correlation handle, where the failure or the active span carries one. */
function traceIdOf(failure: unknown): string | undefined {
  const carried = (failure as { traceId?: unknown } | undefined)?.traceId;

  return typeof carried === "string" && carried.length > 0 ? carried : void 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
