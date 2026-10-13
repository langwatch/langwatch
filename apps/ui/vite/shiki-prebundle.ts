/**
 * DEV-ONLY: prevents Vite from discovering Shiki's WASM engine lazily and
 * re-optimizing mid-session, which stalls the trace drawer on "loading
 * spans". Named THROUGH `@langwatch/design-system` — a bare "shiki" resolves to nothing here.
 */
export const SHIKI_PREBUNDLE_INCLUDE = [
  "@langwatch/design-system > shiki",
  "@langwatch/design-system > shiki > @shikijs/core",
  "@langwatch/design-system > shiki > @shikijs/engine-oniguruma",
  "@langwatch/design-system > shiki > @shikijs/langs",
  "@langwatch/design-system > shiki > @shikijs/themes",
] as const;
