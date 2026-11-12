import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const HERE = fileURLToPath(import.meta.url);
const COMPILER_RUNTIME = fileURLToPath(new URL("../browser/compiler-runtime.ts", import.meta.url));

/** What each React entry point becomes in the browser build. */
export const BROWSER_RUNTIME: Readonly<Record<string, string>> = {
  react: "preact/compat",
  "react-dom": "preact/compat",
  "react-dom/client": "preact/compat/client",
  "react/jsx-runtime": "preact/compat/jsx-runtime",
  "react/jsx-dev-runtime": "preact/compat/jsx-runtime",
};

/**
 * The browser build's islands render on Preact's React compatibility layer, a tenth of
 * react-dom's size. No island hydrates server markup: each mounts with createRoot into an empty
 * node, so prerendering keeps real React and the HTML stays byte for byte the same.
 */
export function browserRuntimePlugin(): Plugin {
  return {
    name: "docs-browser-runtime",
    enforce: "pre",
    apply: "build",
    resolveId(source) {
      if (this.environment.config.consumer !== "client") return null;
      if (source === "react/compiler-runtime") return COMPILER_RUNTIME;
      const target = BROWSER_RUNTIME[source];
      /* Resolved from this package, which owns preact, whoever imports React. */
      return target ? this.resolve(target, HERE, { skipSelf: true }) : null;
    },
  };
}
