/**
 * The Shiki packages the dev server pre-bundles at start.
 *
 * DEV-ONLY: `optimizeDeps` never touches the production build, which bundles
 * Shiki through the design system's `shikiManualChunk` rule. Pre-bundling the
 * whole ecosystem up front is what stops the dev server discovering Shiki's
 * Oniguruma WASM engine — and its langs and themes — lazily on the first
 * /traces navigation and re-optimizing mid-session. That re-optimization
 * invalidates the in-flight `.vite/deps/wasm-*.js` request (onig.wasm, ~620KB)
 * that the span highlighter is awaiting, and the trace drawer stays on
 * "loading spans" for good.
 *
 * Every entry names its package THROUGH the package that owns it. `apps/ui`
 * does not depend on Shiki — `@langwatch/design-system` does — and under
 * pnpm's strict layout a bare "shiki" resolves from here to nothing. Named
 * bare, Vite answered with five "Failed to resolve dependency" errors on every
 * boot and pre-bundled none of it, so the re-optimization this list exists to
 * prevent happened anyway.
 *
 * Lives in its own module so the list is one value the config and its guard
 * both read, rather than a literal only Vite ever sees.
 */
export const SHIKI_PREBUNDLE_INCLUDE = [
  "@langwatch/design-system > shiki",
  "@langwatch/design-system > shiki > @shikijs/core",
  "@langwatch/design-system > shiki > @shikijs/engine-oniguruma",
  "@langwatch/design-system > shiki > @shikijs/langs",
  "@langwatch/design-system > shiki > @shikijs/themes",
] as const;
