/**
 * Bundler constants as this package reads them; declared narrowly to avoid
 * vite/client's unwanted asset-module declarations.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
