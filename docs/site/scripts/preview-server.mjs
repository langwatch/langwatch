import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { preview } from "vite";

import { resolveRedirect } from "../docs-routing.mjs";
export async function startPreview({ outDir, port }) {
  const root = new URL("..", import.meta.url).pathname;
  const redirects = JSON.parse(readFileSync(path.join(outDir, "redirects.json"), "utf8"));
  return preview({
    configFile: false,
    root,
    appType: "mpa",
    build: { outDir },
    preview: { port, host: "127.0.0.1", strictPort: true },
    plugins: [
      {
        name: "docs-directory-urls",
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            const url = new URL(request.url ?? "/", "http://localhost");
            let pathname;
            try {
              pathname = decodeURIComponent(url.pathname);
            } catch {
              response.writeHead(400).end("Invalid URL");
              return;
            }
            const redirect = resolveRedirect({ pathname, search: url.search, redirects });
            if (redirect) {
              response.writeHead(301, { Location: redirect }).end();
              return;
            }
            setExportContentType({ pathname, response });
            const target = path.resolve(outDir, `.${pathname}`, "index.html");
            const withinDist = target.startsWith(outDir + path.sep);
            const hasPage = withinDist && existsSync(target);
            if (hasPage && statSync(target).isFile())
              request.url = `${url.pathname.replace(/\/$/, "")}/index.html${url.search}`;
            else if (!path.extname(pathname) || pathname.endsWith("/")) {
              response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
              createReadStream(path.join(outDir, "404.html")).pipe(response);
              return;
            }
            next();
          });
        },
      },
    ],
  });
}

function setExportContentType({ pathname, response }) {
  if (/\.(md|claude|agent)$/.test(pathname))
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
}
