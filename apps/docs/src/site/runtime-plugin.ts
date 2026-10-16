import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
/* Authored MDX lives outside this package; its JSX runtime and provider resolve from here. */
const SHARED_RUNTIME = new Set(["react/jsx-runtime", "react/jsx-dev-runtime", "@mdx-js/react"]);
const HIGHLIGHT = fileURLToPath(new URL("../features/code/compile/highlight.ts", import.meta.url));

/**
 * Server renders share Node's one React and load Shiki at prerender time instead of bundling it;
 * the browser bundles the runtime this package resolves.
 */
export function runtimePlugin(): Plugin {
  return {
    name: "docs-runtime",
    enforce: "pre",
    resolveId(source, importer) {
      const { consumer, command } = this.environment.config;
      if (SHARED_RUNTIME.has(source))
        return consumer === "server" ? { id: source, external: true } : require.resolve(source);
      const prerender = consumer === "server" && command === "build";
      if (prerender && importer && path.resolve(path.dirname(importer), source) === HIGHLIGHT)
        return { id: HIGHLIGHT, external: "absolute" };
      return null;
    },
  };
}
