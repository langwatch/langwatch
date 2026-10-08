/** Shiki chunk-assignment: core + base in eager, others lazy. File names mirror shikiAdapter.ts. */
const SHIKI_LANGS_OR_THEMES = /[\\/]@shikijs[\\/+](langs|themes)[\\/]/;
const BASE_LANG_FILES = /[\\/](json|markdown|shellscript|bash|typescript|python|ini)\.m?js$/;
const BASE_THEME_FILES = /[\\/](github-dark|github-light)\.m?js$/;
const SHIKI_CORE =
  /[\\/]node_modules[\\/](\.pnpm[\\/])?(@shikijs[\\/+]|shiki[\\/@]|oniguruma-to-es|oniguruma-parser|hast-util-to-html)/;
// `shiki/langs`: the adapter reads it at once to resolve fence names; it only holds lazy
// loaders, so it stays out of the 600 kB engine chunk the adapter imports on first highlight.
const SHIKI_LANG_REGISTRY = /[\\/]shiki[\\/]dist[\\/]langs(-bundle-full-[\w-]+)?\.mjs$/;
// Small hast helpers both Shiki and react-markdown use. A manual chunk swallows its
// dependencies, so left alone these sat in the shiki chunk and every markdown view loaded it.
const HAST_HELPERS =
  /[\\/]node_modules[\\/](\.pnpm[\\/])?(property-information|comma-separated-tokens|space-separated-tokens|hast-util-whitespace|zwitch|ccount|stringify-entities|character-entities-html4|character-entities-legacy|html-void-elements)[\\/@]/;

/** The chunk `id` must land in: "shiki" (the engine, eager base grammars and themes),
 * "shiki-langs" (the language registry), "hast-helpers" (shared with markdown), or
 * undefined to leave it to Rollup's default splitting (→ its own lazy chunk). */
export function shikiManualChunk(id: string): "shiki" | "shiki-langs" | "hast-helpers" | undefined {
  if (HAST_HELPERS.test(id)) return "hast-helpers";
  if (SHIKI_LANG_REGISTRY.test(id)) return "shiki-langs";
  if (SHIKI_LANGS_OR_THEMES.test(id)) {
    if (BASE_LANG_FILES.test(id) || BASE_THEME_FILES.test(id)) return "shiki";
    return undefined;
  }
  if (SHIKI_CORE.test(id)) return "shiki";
  return undefined;
}
