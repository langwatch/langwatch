/**
 * The bundler's own constants, as this package reads them.
 *
 * One reader: the home's development-state switcher, which is gated on
 * `import.meta.env.DEV` so the production build replaces the branch with a
 * literal `false` and the whole switcher is dead code before the bundler looks
 * at it. Declared narrowly rather than by pulling in `vite/client`, which would
 * also bring asset-module declarations this package does not want.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
