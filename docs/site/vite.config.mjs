import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { docsMdxPlugin } from "./docs-mdx.mjs";
import { docsNavPlugin } from "./docs-nav.mjs";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const docsRoot = path.resolve(siteRoot, "..");
export const STATIC_DIRS = ["images", "media", "logo"];
export const STATIC_FILES = ["favicon.svg"];

function serveDocsAssets() {
  return {
    name: "docs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        const [, top] = url.split("/");
        const allowed = STATIC_DIRS.includes(top) || STATIC_FILES.includes(top);
        const file = path.join(docsRoot, url);
        if (!allowed || !existsSync(file) || !statSync(file).isFile()) return next();
        createReadStream(file).pipe(res);
      });
    },
  };
}

export function createViteConfig({ failures = new Map() } = {}) {
  return {
    root: siteRoot,
    publicDir: false,
    plugins: [docsNavPlugin({ docsRoot }), docsMdxPlugin({ failures }), react({ include: /\.(tsx|jsx|mdx)$/ }), serveDocsAssets()],
    resolve: {
      alias: [
        { find: /^\/snippets\//, replacement: `${docsRoot}/snippets/` },
        ...["react/jsx-runtime", "react/jsx-dev-runtime", "@mdx-js/react"].map((name) => ({
          find: new RegExp(`^${name}$`),
          replacement: require.resolve(name),
        })),
      ],
    },
    ssr: { noExternal: ["@langwatch/design-system"] },
    server: { fs: { allow: [path.resolve(docsRoot, "..")] } },
    build: { outDir: "dist", emptyOutDir: true },
  };
}

export default createViteConfig();
