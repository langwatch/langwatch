import { createShikiAdapter } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  bundledLanguagesInfo,
  getSingletonHighlighter,
  type Highlighter,
} from "shiki";

// Eager base: the languages that dominate trace payloads (JSON I/O,
// attribute values, transcripts, markdown). Loaded with the singleton
// highlighter on first use; every other Shiki language is lazy-loaded on
// demand via `ensureShikiLangLoaded`. See
// dev/docs/adr/027-trace-drawer-code-highlighting.md
export const SHIKI_BASE_LANGS = [
  "json",
  "markdown",
  "bash",
  "typescript",
  "python",
  // Eagerly registered for the API-keys ".env" snippet tab (asserted by
  // token-created-snippets) — needs immediate highlighting on first render.
  "ini",
] as const;

export const SHIKI_THEMES = ["github-dark", "github-light"] as const;

type SharedShikiTheme = (typeof SHIKI_THEMES)[number];

function shikiThemeForColorMode(colorMode: string): SharedShikiTheme {
  return colorMode === "dark" ? "github-dark" : "github-light";
}

// Shiki special-cases these as plain passthroughs — no grammar to load, no
// error. Unknown languages are coerced to "text".
const PLAIN_LANGS = new Set(["text", "plaintext", "txt", "plain", "ansi"]);

// Built once from Shiki's own registry: alias/id -> canonical id, and
// canonical id -> dynamic grammar loader. Lets us resolve any bundled
// language (and its official aliases) and lazy-load it on demand, instead
// of maintaining a hand-curated list.
type LangLoader = (typeof bundledLanguagesInfo)[number]["import"];
const ALIAS_TO_CANONICAL = new Map<string, string>();
const LANG_LOADERS = new Map<string, LangLoader>();
for (const info of bundledLanguagesInfo) {
  ALIAS_TO_CANONICAL.set(info.id, info.id);
  LANG_LOADERS.set(info.id, info.import);
  for (const alias of info.aliases ?? []) {
    ALIAS_TO_CANONICAL.set(alias, info.id);
  }
}

/**
 * Resolve a requested code-fence language to a canonical bundled Shiki
 * grammar id (via its aliases), a plain passthrough id, or "text" when Shiki
 * doesn't bundle it. Never throws — this removes the "Language `promql` not
 * found, you may need to load it first" failure mode. See
 * specs/traces-v2/code-block-language-fallback.feature
 */
export function normalizeShikiLang(lang: string | undefined | null): string {
  if (!lang) return "text";
  const l = lang.toLowerCase().trim();
  if (PLAIN_LANGS.has(l)) return l;
  return ALIAS_TO_CANONICAL.get(l) ?? "text";
}

// Sync view of which grammars are ready, so the render path can decide
// without awaiting. Seeded with the eager base (resolved to canonical ids —
// e.g. "bash" loads the "shellscript" grammar) + plain langs; grows as lazy
// loads resolve. In-flight loads are deduped so concurrent blocks of the
// same language share one import.
const loadedLangs = new Set<string>([
  ...SHIKI_BASE_LANGS.map((l) => ALIAS_TO_CANONICAL.get(l) ?? l),
  ...PLAIN_LANGS,
]);
const inFlightLoads = new Map<string, Promise<void>>();

/** True once `canonicalLang`'s grammar is loaded (or it's a plain lang). */
export function isShikiLangReady(canonicalLang: string): boolean {
  return loadedLangs.has(canonicalLang);
}

/**
 * Lazy-load a bundled grammar into the shared singleton highlighter, once.
 * Safe to call repeatedly — concurrent callers share the in-flight promise.
 * No-op for already-loaded / plain / non-bundled languages.
 */
export async function ensureShikiLangLoaded(
  canonicalLang: string,
): Promise<void> {
  if (loadedLangs.has(canonicalLang)) return;
  const loader = LANG_LOADERS.get(canonicalLang);
  if (!loader) return;
  const existing = inFlightLoads.get(canonicalLang);
  if (existing) return existing;
  const load = (async () => {
    const h = await getSharedHighlighter();
    ensureDisposeNeutered(h);
    await h.loadLanguage(loader);
    loadedLangs.add(canonicalLang);
  })().finally(() => inFlightLoads.delete(canonicalLang));
  inFlightLoads.set(canonicalLang, load);
  return load;
}

/**
 * Loads the singleton Shiki highlighter (eager base set) — all call sites
 * resolve to the same `Highlighter` instance via `getSingletonHighlighter`,
 * and `ensureShikiLangLoaded` adds further grammars to it on demand.
 *
 * Without the singleton, every `useShikiAdapter` consumer (RenderedMarkdown,
 * ShikiCodeBlock, …) spun up its own Oniguruma engine and re-loaded the same
 * theme/language JSON. With virtualized chunked markdown views mounting 5–7
 * RenderedMarkdown instances at once, that was N copies of a multi-MB
 * highlighter.
 *
 * Call `ensureDisposeNeutered(h)` after loading when the highlighter must be
 * kept alive app-wide (i.e. in `useShikiAdapter` and `codeToHtml`).
 */
export async function getSharedHighlighter(): Promise<Highlighter> {
  return getSingletonHighlighter({
    langs: [...SHIKI_BASE_LANGS],
    themes: [...SHIKI_THEMES],
  });
}

/**
 * Idempotently monkey-patches `dispose()` to a no-op on the shared singleton
 * highlighter.
 *
 * Chakra's shiki adapter calls `ctx.dispose()` in its `unloadContext` on
 * every CodeBlock unmount and color-mode change. Because every CodeBlock
 * resolves to this one shared instance, the first unmount would dispose the
 * highlighter the still-mounted blocks depend on, and their next
 * `codeToHtml`/`loadTheme` throws "Shiki instance has been disposed". The
 * singleton is app-lifetime by design, so we neuter `dispose` once.
 *
 * The `__lwDisposeNeutered` marker makes the patch idempotent.
 */
export function ensureDisposeNeutered(h: Highlighter): void {
  const h2 = h as Highlighter & {
    dispose: () => void;
    __lwDisposeNeutered?: boolean;
  };
  if (!h2.__lwDisposeNeutered) {
    h2.dispose = () => {
      // Neutered: keep the cached singleton highlighter alive across callers.
    };
    Object.defineProperty(h2, "__lwDisposeNeutered", {
      value: true,
      enumerable: false,
    });
  }
}

export function useShikiAdapter(colorMode: string) {
  return useMemo(
    () =>
      createShikiAdapter<Highlighter>({
        load: async () => {
          const h = await getSharedHighlighter();
          ensureDisposeNeutered(h);
          return h;
        },
        theme: shikiThemeForColorMode(colorMode),
      }),
    [colorMode],
  );
}

/**
 * Renders `code` to an HTML string using the shared singleton highlighter,
 * lazy-loading the language grammar first. Uses `github-light` theme
 * (settings UI is light-theme only).
 *
 * Exposed as a named export so integration tests can spy on it:
 *   `vi.spyOn(shikiAdapter, 'codeToHtml')`
 */
export async function codeToHtml({
  code,
  lang,
}: {
  code: string;
  lang: string;
}): Promise<string> {
  const canonical = normalizeShikiLang(lang);
  await ensureShikiLangLoaded(canonical);
  const highlighter = await getSharedHighlighter();
  ensureDisposeNeutered(highlighter);
  return highlighter.codeToHtml(code, {
    lang: canonical,
    theme: "github-light",
  });
}
