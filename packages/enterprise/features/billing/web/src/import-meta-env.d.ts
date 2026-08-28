/**
 * The one bundler-supplied value this package reads: which Stripe catalogue a
 * build is priced against. Declared here rather than pulled from `vite/client`
 * so the package types on its own, with nothing but the mode in scope.
 */
interface ImportMetaEnv {
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
