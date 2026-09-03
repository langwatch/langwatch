/**
 * The two ambient declarations this package's own source relies on.
 *
 * A workspace package resolves to another's SOURCE, so a consumer compiles
 * these imports with no way to reach a `.d.ts` that only this package's
 * `include` covers — which is why the modules that need them carry a
 * triple-slash reference to this file rather than relying on the tsconfig.
 * (The automations family recorded the same requirement.)
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
