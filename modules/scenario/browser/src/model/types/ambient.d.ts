/**
 * The module shapes this package's own `include` has to state for itself.
 */

declare module "*.css";

/**
 * `import.meta.env`, for a dependency's source this program also compiles.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
