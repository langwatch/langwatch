import path from "node:path";

import react from "@vitejs/plugin-react";
import type { InlineConfig } from "vite";

import { docsOpenapiPlugin } from "../features/api-reference/compile/openapi.ts";
import { docsMdxPlugin } from "../features/content/compile/mdx-plugin.ts";
import { docsPagesPlugin } from "../features/content/compile/pages-plugin.ts";
import { docsNavPlugin } from "../features/navigation/compile/nav-plugin.ts";
import { openapiPages } from "../features/navigation/compile/nav.ts";
import { appRoot, docsRoot } from "../paths.ts";
import { docsDevPlugin } from "./dev-server.ts";
import { ISLAND_NAMES, ISLANDS } from "./document.ts";
import { runtimePlugin } from "./runtime-plugin.ts";

/** The one Vite configuration: dev server, client build and the prerender (SSR) build. */
export function createViteConfig({
  sourceRoot = docsRoot,
  outDir = "dist",
  basePath = "",
}: { sourceRoot?: string; outDir?: string; basePath?: string } = {}): InlineConfig {
  let operationSlugs: Record<string, string> | undefined;
  const openapiBySlug = () => (operationSlugs ??= openapiPages({ docsRoot: sourceRoot }));
  return {
    root: appRoot,
    base: `${basePath}/`,
    define: { __DOCS_BASE_PATH__: JSON.stringify(basePath) },
    publicDir: "public",
    plugins: [
      runtimePlugin(),
      docsNavPlugin({ docsRoot: sourceRoot }),
      docsOpenapiPlugin({ docsRoot: sourceRoot, openapiBySlug }),
      docsMdxPlugin({ docsRoot: sourceRoot }),
      // Oxc's React Compiler memoises the docs' own islands; plugin-react skips it for SSR, so
      // prerendered HTML is unchanged. Design-system sources stay as published (smaller chunks).
      react({
        include: /\.(tsx|jsx|mdx)$/,
        exclude: [/\/node_modules\//, /\/packages\/design-system\//],
        compiler: true,
      }),
      docsDevPlugin({ docsRoot: sourceRoot }),
      docsPagesPlugin({
        docsRoot: sourceRoot,
        onSourceChange: () => {
          operationSlugs = undefined;
        },
      }),
    ],
    // Authored MDX lives outside the app, so resolve React and the MDX provider from here.
    resolve: {
      alias: [{ find: /^\/snippets\//, replacement: `${sourceRoot}/snippets/` }],
      dedupe: ["react", "react-dom", "@mdx-js/react"],
    },
    ssr: {
      noExternal: ["@langwatch/design-system"],
      external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
      optimizeDeps: { include: ["react/jsx-runtime", "react/jsx-dev-runtime"] },
    },
    server: {
      fs: { allow: [path.resolve(docsRoot, ".."), sourceRoot] },
      watch: { ignored: ["**/apps/docs/dist/**"] },
    },
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: {
          index: path.join(appRoot, "index.html"),
          ...Object.fromEntries(
            ISLAND_NAMES.map((name) => [name, path.join(appRoot, ISLANDS[name])]),
          ),
        },
      },
    },
  };
}
