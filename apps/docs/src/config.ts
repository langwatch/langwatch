/* The one seam over Vite's build-time env; optional so plain Node (the compiler) can import it. */
export const isProduction = import.meta.env?.PROD ?? false;
/* createViteConfig defines the build's base path as a constant, so a root build folds it away. */
declare const __DOCS_BASE_PATH__: string | undefined;
/** "" at the production root or "/docs" under a prefix; "" in plain Node. */
export const docsBasePath: string =
  typeof __DOCS_BASE_PATH__ === "string"
    ? __DOCS_BASE_PATH__
    : (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
