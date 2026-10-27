/**
 * Ambient declarations for cross-workspace imports; modules reference via triple-slash directive
 */

/** The front door ships one stylesheet; the bundler owns what an import of it means. */
declare module "*.css";

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
