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
  const target = path.resolve(outDir, `.${sitePathname}`, "index.html");
  const hasPage = target.startsWith(outDir + path.sep) && existsSync(target);
  if (hasPage && statSync(target).isFile()) {
    request.url = `${sitePath.replace(/\/$/, "")}/index.html${url.search}`;
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
