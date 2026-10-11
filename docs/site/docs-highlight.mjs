import { bundledLanguages, createHighlighter } from "shiki";

const THEMES = { light: "github-light", dark: "github-dark" };
let loading;

function loadShiki() {
  loading ??= createHighlighter({ themes: Object.values(THEMES), langs: [] });
  return loading;
}

function escapeHtml({ text }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns one HTML string per source line, with light and dark colours as CSS variables. */
export async function highlightLines({ code, lang }) {
  const highlighter = await loadShiki();
  const known = lang && lang in bundledLanguages;
  if (known) await highlighter.loadLanguage(lang);
  const lines = known
    ? highlighter.codeToTokensWithThemes(code, { lang, themes: THEMES })
    : code.split("\n").map((line) => [{ content: line, variants: {} }]);
  return lines.map((tokens) =>
    tokens
      .map((token) => {
        const light = token.variants.light;
        const dark = token.variants.dark;
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
