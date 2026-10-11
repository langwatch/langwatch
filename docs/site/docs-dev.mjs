import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pageMarkdown } from "./docs-markdown.mjs";
import { buildNav } from "./docs-nav.mjs";
import { llmsDirectory } from "./docs-output.mjs";
import { readRedirects, resolveRedirect } from "./docs-routing.mjs";
import { bodyText, searchTrail } from "./docs-search.mjs";
import { ISLANDS, islandHead, pageData, themeScript } from "./docs-static.mjs";
import { extractStyles } from "./scripts/static-styles.mjs";

export const STATIC_DIRS = ["images", "media", "logo"];
export const STATIC_FILES = ["favicon.svg"];

function devSearch({ docsRoot }) {
  const nav = buildNav({ docsRoot });
  return Object.entries(nav.pages).map(([slug, meta]) => {
    const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
    return {
      slug,
      title: meta.title,
      description: meta.description,
      ...searchTrail({ nav, slug }),
      body: bodyText({ html: `<article>${source.replace(/^---[\s\S]*?---/, "")}</article>` }),
      headings: [],
    };
  });
}

function serveMarkdown({ docsRoot, pathname, response }) {
  const slug = pathname.slice(1, -3);
  const { pages } = buildNav({ docsRoot });
  if (!Object.hasOwn(pages, slug)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.setHeader("Content-Type", "text/markdown; charset=utf-8");
  response.end(pageMarkdown({ docsRoot, slug }));
}

function serveSource({ docsRoot, pathname, response, next }) {
  if (pathname === "/llms.txt") {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(llmsDirectory({ nav: buildNav({ docsRoot }) }));
    return;
  }
  if (pathname === "/search-index.json") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(devSearch({ docsRoot })));
    return;
  }
  if (pathname.endsWith(".md")) return serveMarkdown({ docsRoot, pathname, response });
  const [, top] = pathname.split("/");
  const allowed = STATIC_DIRS.includes(top) || STATIC_FILES.includes(top);
  const file = path.resolve(docsRoot, `.${pathname}`);
  if (!file.startsWith(docsRoot + path.sep)) return next();
  if (!allowed || !existsSync(file)) return next();
  if (!statSync(file).isFile()) return next();
  createReadStream(file).pipe(response);
}

export function docsDevPlugin({ docsRoot }) {
  return {
    name: "docs-dev",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          response.writeHead(400).end("Invalid URL");
          return;
        }
        const redirect = resolveRedirect({
          pathname,
          search: url.search,
          redirects: readRedirects({ docsRoot }),
        });
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

async function serveDocument({ request, response, next, server, docsRoot }) {
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
    const { render } = await server.ssrLoadModule("/src/entry-server.tsx");
    const result = await render({ slug: known ? slug : "404" });
    const styled = extractStyles({ html: result.html });
    const template = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
    const sources = Object.fromEntries(
      ISLANDS.map((name) => [
        name,
        `/src/islands/${name}.${["search", "playground"].includes(name) ? "tsx" : "ts"}`,
      ]),
    );
    const html = template
      .replace("<!--islands-->", themeScript + islandHead({ sources }))
      .replace(
        "<!--head-->",
        `<title>${result.title.replaceAll("<", "&lt;")}</title><style data-docs-style>${styled.css}</style>`,
      )
      .replace("<!--app-->", styled.html)
      .replace("</body>", `${pageData({ slug, operation: result.operation })}</body>`);
    response.statusCode = known ? 200 : 404;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(await server.transformIndexHtml(url.pathname, html));
  } catch (error) {
    next(error);
  }
}
