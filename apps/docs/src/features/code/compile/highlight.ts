import { bundledLanguages, createHighlighter, type BundledLanguage } from "shiki";

const THEMES = { light: "github-light", dark: "github-dark" } as const;
let loading: ReturnType<typeof createHighlighter> | undefined;

function loadShiki() {
  loading ??= createHighlighter({ themes: Object.values(THEMES), langs: [] });
  return loading;
}

function escapeHtml({ text }: { text: string }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns one HTML string per source line, with light and dark colours as CSS variables. */
export async function highlightLines({ code, lang }: { code: string; lang: string }) {
  const highlighter = await loadShiki();
  const known = Boolean(lang) && lang in bundledLanguages;
  if (known) await highlighter.loadLanguage(lang as BundledLanguage);
  const lines = known
    ? highlighter.codeToTokensWithThemes(code, { lang: lang as BundledLanguage, themes: THEMES })
    : code.split("\n").map((line) => [{ content: line, variants: {} }]);
  return lines.map((tokens) =>
    tokens
      .map((token) => {
        const { light, dark } = token.variants as Record<
          "light" | "dark",
          { color?: string; fontStyle?: number } | undefined
        >;
        if (!light && !dark) return escapeHtml({ text: token.content });
        const style = [light?.color && `--sl:${light.color}`, dark?.color && `--sd:${dark.color}`]
          .filter(Boolean)
          .join(";");
        const italic = (light?.fontStyle ?? 0) & 1 ? ";font-style:italic" : "";
        return `<span style="${style}${italic}">${escapeHtml({ text: token.content })}</span>`;
      })
      .join(""),
  );
}
