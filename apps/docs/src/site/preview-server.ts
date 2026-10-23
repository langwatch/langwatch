import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { preview } from "vite";

import {
  readBuiltRedirects,
  resolveRedirect,
  type Redirects,
} from "../features/navigation/compile/redirects.ts";
import { stripBasePath } from "../lib/site-path.ts";
import { appRoot } from "../paths.ts";
import { isHashedFile } from "./hashed-assets.ts";

function setExportContentType({
  pathname,
  response,
}: {
  pathname: string;
  response: ServerResponse;
}) {
  if (/\.(md|claude|agent)$/.test(pathname))
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
}

/**
 * How long a host may keep a file: hashed files forever, other media a day, documents never
 * stale.
 */
export function cachePolicy({ sitePathname }: { sitePathname: string }) {
  if (isHashedFile({ sitePath: sitePathname })) return "public, max-age=31536000, immutable";
  if (/^\/(fonts|images|media|logo)\//.test(sitePathname))
    return "public, max-age=86400, stale-while-revalidate=604800";
  return "no-cache";
}

function quality({ accept, type }: { accept: string; type: string }) {
  for (const part of accept.split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (name?.trim().toLowerCase() !== type) continue;
    const q = params.find((param) => param.trim().startsWith("q="));
    return q ? Number(q.trim().slice(2)) || 0 : 1;
  }
  return 0;
}

/** Whether a request asks for Markdown at least as much as HTML, as an agent's fetch does. */
export function prefersMarkdown({ accept }: { accept: string }) {
  const markdown = quality({ accept, type: "text/markdown" });
  return markdown > 0 && markdown >= quality({ accept, type: "text/html" });
}

/** The site path of a page's Markdown twin: `/guide` -> `/guide.md`, the home -> `/index.md`. */
export function markdownTwin({ sitePathname }: { sitePathname: string }) {
  return `${sitePathname.replace(/\/$/, "") || "/index"}.md`;
}

/* Vite's static files write their own Cache-Control as they are sent; this one wins. */
function holdCachePolicy({ response, policy }: { response: ServerResponse; policy: string }) {
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
  response.writeHead = ((...args: unknown[]) => {
    for (const arg of args)
      if (arg && typeof arg === "object" && !Array.isArray(arg))
        (arg as Record<string, string>)["Cache-Control"] = policy;
    response.setHeader("Cache-Control", policy);
    return writeHead(...args);
  }) as ServerResponse["writeHead"];
}

/** Rewrites a page request to its HTML, or to its Markdown twin when that is what was asked. */
function servePage({
  request,
  response,
  outDir,
  basePath,
  sitePath,
  sitePathname,
  search,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  outDir: string;
  basePath: string;
  sitePath: string;
  sitePathname: string;
  search: string;
}) {
  const twin = markdownTwin({ sitePathname });
  response.appendHeader("Vary", "Accept");
  request.url = `${sitePath.replace(/\/$/, "")}/index.html${search}`;
  if (!existsSync(path.join(outDir, `.${twin}`))) return;
  response.setHeader("Link", `<${basePath}${twin}>; rel="alternate"; type="text/markdown"`);
  if (!prefersMarkdown({ accept: request.headers.accept ?? "" })) return;
  request.url = `${encodeURI(twin)}${search}`;
  setExportContentType({ pathname: twin, response });
}

/** Where a mounted request goes: answered here (true) or rewritten for Vite's static files. */
function routeRequest({
  request,
  response,
  outDir,
  basePath,
  redirects,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  outDir: string;
  basePath: string;
  redirects: Redirects;
}): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Invalid URL");
    return true;
  }
  if (basePath && (pathname === "/" || pathname === basePath)) {
    response.writeHead(301, { Location: `${basePath}/${url.search}` }).end();
    return true;
  }
  const redirect = resolveRedirect({ pathname, search: url.search, redirects, basePath });
  if (redirect) {
    response.writeHead(301, { Location: redirect }).end();
    return true;
  }
  const sitePathname = stripBasePath({ pathname, basePath });
  if (sitePathname === null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Not found: the documentation is served under ${basePath}/`);
    return true;
  }
  const sitePath = url.pathname.slice(basePath.length) || "/";
  request.url = `${sitePath}${url.search}`;
  setExportContentType({ pathname: sitePathname, response });
  holdCachePolicy({ response, policy: cachePolicy({ sitePathname }) });
  const target = path.resolve(outDir, `.${sitePathname}`, "index.html");
  const hasPage = target.startsWith(outDir + path.sep) && existsSync(target);
  if (hasPage && statSync(target).isFile()) {
    servePage({ request, response, outDir, basePath, sitePath, sitePathname, search: url.search });
    return false;
  }
  if (!path.extname(sitePathname) || sitePathname.endsWith("/")) {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(path.join(outDir, "404.html")).pipe(response);
    return true;
  }
  return false;
}

/**
 * Serves a build with the static-host contract: redirects (301, query kept), `/path` and `/path/`
 * to `/path/index.html`, 404.html with status 404, 400 for malformed encoding. Under a base path
 * the build is mounted there; `/` and the bare prefix move to `${basePath}/`.
 */
export async function startPreview({
  outDir,
  port,
  basePath = "",
}: {
  outDir: string;
  port: number;
  basePath?: string;
}) {
  const redirects = readBuiltRedirects({ outDir });
  return preview({
    configFile: false,
    root: appRoot,
    appType: "mpa",
    build: { outDir },
    preview: { port, host: "127.0.0.1", strictPort: true },
    plugins: [
      {
        name: "docs-directory-urls",
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!routeRequest({ request, response, outDir, basePath, redirects })) next();
          });
        },
      },
    ],
  });
}
