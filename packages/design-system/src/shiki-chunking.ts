/** Shiki chunk-assignment: core + base in eager, others lazy. File names mirror shikiAdapter.ts. */
const SHIKI_LANGS_OR_THEMES = /[\\/]@shikijs[\\/+](langs|themes)[\\/]/;
const BASE_LANG_FILES = /[\\/](json|markdown|shellscript|bash|typescript|python|ini)\.m?js$/;
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
