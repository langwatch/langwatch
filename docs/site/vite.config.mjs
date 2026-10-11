import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";

import { docsDevPlugin } from "./docs-dev.mjs";
import { docsPagesPlugin } from "./docs-pages.mjs";
import { ISLANDS } from "./docs-static.mjs";
export { STATIC_DIRS, STATIC_FILES } from "./docs-dev.mjs";
import { docsMdxPlugin } from "./docs-mdx.mjs";
import { docsNavPlugin, openapiPages } from "./docs-nav.mjs";
import { docsOpenapiPlugin } from "./docs-openapi.mjs";
import { lucideRoot } from "./ds-deps.mjs";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const docsRoot = path.resolve(siteRoot, "..");
export function createViteConfig({ sourceRoot = docsRoot, outDir = "dist" } = {}) {
  let operationSlugs;
  const openapiBySlug = () => (operationSlugs ??= openapiPages({ docsRoot: sourceRoot }));
  return {
    root: siteRoot,
    publicDir: "public",
    plugins: [
      docsNavPlugin({ docsRoot: sourceRoot }),
      docsOpenapiPlugin({ docsRoot: sourceRoot, openapiBySlug }),
      docsMdxPlugin({ docsRoot: sourceRoot }),
      react({ include: /\.(tsx|jsx|mdx)$/ }),
      docsDevPlugin({ docsRoot: sourceRoot }),
      docsPagesPlugin({
        docsRoot: sourceRoot,
        onSourceChange: () => {
          operationSlugs = void 0;
        },
      }),
    ],
    resolve: {
      alias: [
        { find: /^lucide-react$/, replacement: lucideRoot() },
        { find: /^\/snippets\//, replacement: `${sourceRoot}/snippets/` },
        ...["react/jsx-runtime", "react/jsx-dev-runtime", "@mdx-js/react"].map((name) => ({
          find: new RegExp(`^${name}$`),
          replacement: require.resolve(name),
          customResolver(source, importer, options) {
            return {
              id: source,
              external: Boolean(options.ssr || this.environment?.name === "ssr"),
            };
          },
        })),
      ],
    },
    ssr: {
      noExternal: ["@langwatch/design-system"],
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        require.resolve("react/jsx-runtime"),
        require.resolve("react/jsx-dev-runtime"),
      ],
      optimizeDeps: { include: ["react/jsx-runtime", "react/jsx-dev-runtime"] },
    },
    server: {
      fs: { allow: [path.resolve(docsRoot, ".."), sourceRoot] },
      watch: { ignored: ["**/site/dist/**", "**/site/dist-ssr/**"] },
    },
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: {
          index: path.join(siteRoot, "index.html"),
          ...Object.fromEntries(
            ISLANDS.map((name) => [
              name,
              path.join(
                siteRoot,
                `src/islands/${name}.${["search", "playground", "context-menus"].includes(name) ? "tsx" : "ts"}`,
              ),
            ]),
          ),
        },
      },
    },
  };
}

export default createViteConfig();
