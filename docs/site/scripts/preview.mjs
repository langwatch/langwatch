import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

import { preview } from "vite";

const root = new URL("..", import.meta.url).pathname;
const server = await preview({
  configFile: false,
  root,
  appType: "mpa",
  preview: { port: 4173 },
  plugins: [
    {
      name: "docs-directory-urls",
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          const pathname = decodeURIComponent(url.pathname);
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
