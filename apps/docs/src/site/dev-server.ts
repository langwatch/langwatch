import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Connect, Plugin, ViteDevServer } from "vite";

import type { render as renderPage } from "../app/entry-server.tsx";
import {
  discoveryFiles,
  exportSlug,
  PAGE_EXPORT_EXTENSIONS,
} from "../features/discovery/compile/discovery-files.ts";
import { pageMarkdown } from "../features/discovery/compile/markdown-export.ts";
import { breadcrumbTrail, pageHead } from "../features/discovery/compile/page-head.ts";
import { buildNav } from "../features/navigation/compile/nav.ts";
import { siteRedirects, resolveRedirect } from "../features/navigation/compile/redirects.ts";
import { sourceSearchIndex } from "../features/search/compile/search-index.ts";
import { appRoot } from "../paths.ts";
import {
  composeDocument,
  islandHead,
  NOT_FOUND_HEAD,
  ISLAND_NAMES,
  ISLANDS,
  STATIC_DIRS,
  STATIC_FILES,
  extractStyles,
} from "./document.ts";

const DEV_SOURCES = Object.fromEntries(ISLAND_NAMES.map((name) => [name, `/${ISLANDS[name]}`]));
/* Linked so the first paint is styled; the bootstrap's own imports only take over for updates. */
const DEV_STYLES = ["/src/app/docs.css", "/src/browser/islands.css"]
  .map((href) => `<link rel="stylesheet" href="${href}">`)
  .join("");

function send({ response, type, body }: { response: ServerResponse; type: string; body: string }) {
  response.setHeader("Content-Type", type);
  response.end(body);
}

/** Generated files the build writes, served live from source: exports, discovery, search, media. */
function serveSource({
  docsRoot,
  pathname,
  response,
  next,
}: {
  docsRoot: string;
  pathname: string;
  response: ServerResponse;
  next: Connect.NextFunction;
}) {
  const nav = buildNav({ docsRoot });
  const discovered = discoveryFiles({ nav })[pathname.slice(1)];
  if (discovered) {
    const type = pathname.endsWith(".xml") ? "application/xml" : "text/plain";
    return send({ response, type: `${type}; charset=utf-8`, body: discovered });
  }
  if (pathname === "/search-index.json") {
    const body = JSON.stringify(sourceSearchIndex({ docsRoot, nav }));
    return send({ response, type: "application/json; charset=utf-8", body });
  }
  if (PAGE_EXPORT_EXTENSIONS.some((extension) => pathname.endsWith(`.${extension}`))) {
    const exported = exportSlug({ pathname });
    const slug = Object.hasOwn(nav.pages, exported) ? exported : `${exported}/index`;
    if (!Object.hasOwn(nav.pages, slug)) return void response.writeHead(404).end("Not found");
    const body = pageMarkdown({ docsRoot, slug });
    return send({ response, type: "text/markdown; charset=utf-8", body });
  }
  const [, top] = pathname.split("/");
  const allowed = STATIC_DIRS.includes(top) || STATIC_FILES.includes(top);
  const file = path.resolve(docsRoot, `.${pathname}`);
  if (!file.startsWith(docsRoot + path.sep)) return next();
  if (!allowed || !existsSync(file)) return next();
  if (!statSync(file).isFile()) return next();
  if (path.extname(file) === ".svg") response.setHeader("Content-Type", "image/svg+xml");
  createReadStream(file).pipe(response);
}

/** Renders a page per request with the same document structure, styles and islands as the build. */
async function serveDocument({
  request,
  response,
  next,
  server,
  docsRoot,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  next: Connect.NextFunction;
  server: ViteDevServer;
  docsRoot: string;
}) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (
    request.method !== "GET" ||
    /\.[a-z0-9]+$/i.test(url.pathname) ||
    /^\/(?:src|@|node_modules)/.test(url.pathname)
  )
    return next();
  try {
    const slug = url.pathname.replace(/^\/+|\/+$/g, "") || "introduction";
    const known = Object.hasOwn(buildNav({ docsRoot }).pages, slug);
    const entry = await server.ssrLoadModule("/src/app/entry-server.tsx");
    const render: typeof renderPage = entry.render;
    const result = await render({ slug: known ? slug : "404" });
    const styled = extractStyles({ html: result.html });
    const { anchors } = buildNav({ docsRoot });
    const trail = breadcrumbTrail({ sections: anchors, slug, title: result.title });
    const head = known
      ? pageHead({ slug, title: result.title, description: result.description, trail })
      : NOT_FOUND_HEAD;
    const html = composeDocument({
      template: readFileSync(path.join(appRoot, "index.html"), "utf8"),
      islands: islandHead({ sources: DEV_SOURCES }),
      head: `${head}${DEV_STYLES}<style data-docs-style>${styled.css}</style>`,
      app: styled.html,
      slug,
      operation: result.operation,
    });
    response.statusCode = known ? 200 : 404;
    send({
      response,
      type: "text/html; charset=utf-8",
      body: await server.transformIndexHtml(url.pathname, html),
    });
  } catch (error) {
    next(error);
  }
}

/** Dev server routes: redirects, generated files and server-rendered pages. */
export function docsDevPlugin({ docsRoot }: { docsRoot: string }): Plugin {
  return {
    name: "docs-dev",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        let pathname: string;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          response.writeHead(400).end("Invalid URL");
          return;
        }
        const slugs = Object.keys(buildNav({ docsRoot }).pages);
        const redirects = siteRedirects({ docsRoot, slugs });
        const redirect = resolveRedirect({ pathname, search: url.search, redirects });
        if (redirect) {
          response.writeHead(301, { Location: redirect }).end();
          return;
        }
        serveSource({ docsRoot, pathname, response, next });
      });
      server.middlewares.use((request, response, next) =>
        serveDocument({ request, response, next, server, docsRoot }),
      );
    },
  };
}
