import path from "node:path";

import react from "@vitejs/plugin-react";
import type { InlineConfig } from "vite";

import { docsOpenapiPlugin } from "../features/api-reference/compile/openapi.ts";
import { docsMdxPlugin } from "../features/content/compile/mdx-plugin.ts";
import { docsPagesPlugin } from "../features/content/compile/pages-plugin.ts";
import { docsNavPlugin } from "../features/navigation/compile/nav-plugin.ts";
import { openapiPages } from "../features/navigation/compile/nav.ts";
import { appRoot, docsRoot } from "../paths.ts";
import { browserRuntimePlugin } from "./browser-runtime-plugin.ts";
import { docsDevPlugin } from "./dev-server.ts";
import { ISLAND_NAMES, ISLANDS } from "./document.ts";
import { runtimePlugin } from "./runtime-plugin.ts";

/* Chakra's and Ark's config helpers and component factories are identity or pure wrappers the
   bundler cannot prove pure across modules, so an unused theme, recipe or part stayed in every
   island. Getter-free reads drop theme objects built from other ones. */
const CLIENT_TREESHAKE = {
  propertyReadSideEffects: false,
  /* The design system declares no `sideEffects`; its TypeScript modules only declare things. */
  moduleSideEffects: (id: string) =>
    /\/packages\/design-system\/src\/.*\.tsx?$/.test(id) ? false : undefined,
  manualPureFunctions: [
    ...["Config", "Recipe", "SlotRecipe", "Style", "Tokens", "SemanticTokens"].map(
      (n) => `define${n}`,
    ),
    ...["GlobalStyles", "Keyframes", "TextStyles", "LayerStyles", "AnimationStyles"].map(
      (n) => `define${n}`,
    ),
    "createAnatomy",
    "withContext",
    "withProvider",
    "withRootProvider",
    "withPropsProvider",
    "forwardRef",
    "memo",
  ],
} as const;

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
      browserRuntimePlugin(),
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
      /* Islands load as plain module scripts and every target browser reads modulepreload. */
      modulePreload: { polyfill: false },
      rollupOptions: {
        treeshake: CLIENT_TREESHAKE,
        /* Inlines the base path into each chunk, so a /docs bootstrap imports no config chunk. */
        optimization: { inlineConst: { mode: "all", pass: 2 } },
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
