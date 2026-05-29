import { createShikiAdapter } from "@chakra-ui/react";
import { useMemo } from "react";
import { getSingletonHighlighter, type HighlighterGeneric } from "shiki";

const SHIKI_LANGS = [
  "markdown",
  "json",
  "bash",
  "typescript",
  "python",
  "xml",
  "html",
  "yaml",
  "ini",
] as const;

const SHIKI_THEMES = ["github-dark", "github-light"] as const;

type SharedHighlighter = HighlighterGeneric<
  (typeof SHIKI_LANGS)[number],
  (typeof SHIKI_THEMES)[number]
>;

type SharedShikiTheme = (typeof SHIKI_THEMES)[number];

function shikiThemeForColorMode(colorMode: string): SharedShikiTheme {
  return colorMode === "dark" ? "github-dark" : "github-light";
}

/**
 * Loads the singleton Shiki highlighter — all call sites resolve to the
 * same `Highlighter` instance via `getSingletonHighlighter`.
 *
 * Without this, every `useShikiAdapter` consumer (RenderedMarkdown,
 * ShikiCodeBlock, …) spun up its own Oniguruma engine and re-loaded the
 * same theme/language JSON. With virtualized chunked markdown views
 * mounting 5–7 RenderedMarkdown instances at once, that was N copies of
 * a multi-MB highlighter.
 *
 * `getSingletonHighlighter` is Shiki's own dedup primitive; calling it
 * with the same `(langs, themes)` returns the same promise. The
 * standalone `codeToTokens` / `codeToHtml` exports go through it too,
 * so our adapter and any direct callers share one instance.
 *
 * Call `ensureDisposeNeutered(h)` after loading when the highlighter
 * must be kept alive app-wide (i.e. in `useShikiAdapter` and `codeToHtml`).
 */
export async function getSharedHighlighter(): Promise<SharedHighlighter> {
  return (await getSingletonHighlighter({
    langs: [...SHIKI_LANGS],
    themes: [...SHIKI_THEMES],
  })) as SharedHighlighter;
}

/**
 * Idempotently monkey-patches `dispose()` to a no-op on the shared
 * singleton highlighter.
 *
 * Chakra's shiki adapter calls `ctx.dispose()` in its `unloadContext`
 * on every CodeBlock unmount and color-mode change. Because every
 * CodeBlock resolves to this one shared instance, the first unmount
 * would dispose the highlighter the still-mounted blocks depend on,
 * and their next `codeToHtml`/`loadTheme` throws
 * "Shiki instance has been disposed". The singleton is app-lifetime by
 * design, so we neuter `dispose` once — nothing should ever tear this
 * instance down.
 *
 * The `__lwDisposeNeutered` marker makes the patch idempotent — calling
 * this function twice is safe.
 */
export function ensureDisposeNeutered(h: SharedHighlighter): void {
  const h2 = h as SharedHighlighter & {
    dispose: () => void;
    __lwDisposeNeutered?: boolean;
  };
  if (!h2.__lwDisposeNeutered) {
    h2.dispose = () => {};
    Object.defineProperty(h2, "__lwDisposeNeutered", {
      value: true,
      enumerable: false,
    });
  }
}

export function useShikiAdapter(colorMode: string) {
  return useMemo(
    () =>
      createShikiAdapter<SharedHighlighter>({
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
 * Renders `code` to an HTML string using the shared singleton highlighter.
 * Uses `github-light` theme (settings UI is light-theme only).
 *
 * The result is a stable string for a given (code, lang) pair — callers
 * may pre-compute both the masked and unmasked forms at mount and then
 * simply swap between the two strings to avoid re-tokenizing on reveal.
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
  const highlighter = await getSharedHighlighter();
  ensureDisposeNeutered(highlighter);
  return highlighter.codeToHtml(code, {
    lang,
    theme: "github-light",
  });
}
