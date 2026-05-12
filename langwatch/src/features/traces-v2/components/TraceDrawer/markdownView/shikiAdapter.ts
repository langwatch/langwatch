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
 * Singleton highlighter shared across the whole app — all Shiki call sites
 * (Chakra `CodeBlock` adapters, `codeToTokens` for JSON, `codeToHtml` for
 * inline blocks) resolve to the same `Highlighter` instance.
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
 */
function getSharedHighlighter(): Promise<SharedHighlighter> {
  return getSingletonHighlighter({
    langs: [...SHIKI_LANGS],
    themes: [...SHIKI_THEMES],
  }) as Promise<SharedHighlighter>;
}

export function useShikiAdapter(colorMode: string) {
  return useMemo(
    () =>
      createShikiAdapter<SharedHighlighter>({
        load: getSharedHighlighter,
        theme: shikiThemeForColorMode(colorMode),
      }),
    [colorMode],
  );
}
