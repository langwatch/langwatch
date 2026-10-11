import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { preview } from "vite";

import { resolveRedirect } from "../docs-routing.mjs";

const root = new URL("..", import.meta.url).pathname;
const redirects = JSON.parse(readFileSync(path.join(root, "dist/redirects.json"), "utf8"));
const server = await preview({
  configFile: false,
  root,
  appType: "mpa",
  preview: { port: 4173, strictPort: true },
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
          const target = path.resolve(root, "dist", `.${pathname}`, "index.html");
          const withinDist = target.startsWith(path.resolve(root, "dist") + path.sep);
          const hasPage = withinDist && existsSync(target);
          if (hasPage && statSync(target).isFile())
            request.url = `${url.pathname.replace(/\/$/, "")}/index.html${url.search}`;
          else if (!path.extname(pathname) || pathname.endsWith("/")) {
            response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
            createReadStream(path.join(root, "dist", "404.html")).pipe(response);
            return;
          }
          next();
        });
      },
    },
  ],
});
server.printUrls();
