/**
 * Pure chunk-assignment for Shiki modules, shared by the Vite build
 * (`vite.config.ts` `manualChunks`) and its guard test so the test can exercise
 * the REAL logic instead of scraping the config source.
 *
 * Keeps Shiki's core (engine + oniguruma + singleton factory) plus only the
 * base grammars/themes the app highlights on first paint in the eager `shiki`
 * chunk; every other bundled grammar (~340 of them) falls through to its own
 * lazy chunk, loaded on demand by shikiAdapter.ts (`ensureShikiLangLoaded`).
 *
 * The base grammar FILE names below (bash's grammar file is `shellscript`) and
 * base themes must mirror SHIKI_BASE_LANGS / SHIKI_THEMES in shikiAdapter.ts —
 * `shikiChunking.unit.test.ts` exercises this function against those canonical
 * lists and fails if they drift. Deliberately dependency-free so the Vite
 * config can import it without pulling in the runtime highlighter.
 */
const SHIKI_LANGS_OR_THEMES = /[\\/]@shikijs[\\/+](langs|themes)[\\/]/;
const BASE_LANG_FILES =
  /[\\/](json|markdown|shellscript|bash|typescript|python|ini)\.m?js$/;
const BASE_THEME_FILES = /[\\/](github-dark|github-light)\.m?js$/;
const SHIKI_CORE =
  /[\\/]node_modules[\\/](\.pnpm[\\/])?(@shikijs[\\/+]|shiki[\\/@]|oniguruma-to-es|oniguruma-parser|hast-util-to-html)/;

/** Returns "shiki" to force `id` into the eager chunk, or undefined to leave it
 * to Rollup's default splitting (→ its own lazy chunk). */
export function shikiManualChunk(id: string): "shiki" | undefined {
  if (SHIKI_LANGS_OR_THEMES.test(id)) {
    if (BASE_LANG_FILES.test(id) || BASE_THEME_FILES.test(id)) return "shiki";
    return undefined;
  }
  if (SHIKI_CORE.test(id)) return "shiki";
  return undefined;
}
