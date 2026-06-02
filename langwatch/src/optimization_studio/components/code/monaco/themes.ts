import type { editor } from "monaco-editor";
import monokai from "../Monokai.json";

export const MONACO_THEME_DARK = "langwatch-dark";
export const MONACO_THEME_LIGHT = "langwatch-light";

const monokaiTheme = monokai as unknown as editor.IStandaloneThemeData;

/**
 * Light theme tuned to match LangWatch panel surfaces — slightly warmer than
 * Monaco's default `vs` so the editor doesn't look transplanted from VS Code.
 */
const lightTheme: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8E908C", fontStyle: "italic" },
    { token: "keyword", foreground: "8959A8" },
    { token: "keyword.flow", foreground: "8959A8" },
    { token: "string", foreground: "718C00" },
    { token: "number", foreground: "F5871F" },
    { token: "type", foreground: "4271AE" },
    { token: "type.identifier", foreground: "4271AE" },
    { token: "identifier", foreground: "3E3E3E" },
    { token: "delimiter", foreground: "3E3E3E" },
    { token: "operator", foreground: "3E999F" },
  ],
  colors: {
    "editor.background": "#FAFAFA",
    "editor.foreground": "#3E3E3E",
    "editorLineNumber.foreground": "#BFBFBF",
    "editorLineNumber.activeForeground": "#7A7A7A",
    "editor.selectionBackground": "#D6D6D6AA",
    "editor.inactiveSelectionBackground": "#E6E6E6AA",
    "editor.lineHighlightBackground": "#EFEFEF",
    "editorCursor.foreground": "#3E3E3E",
    "editorIndentGuide.background": "#E6E6E6",
    "editorIndentGuide.activeBackground": "#BFBFBF",
    "editorWhitespace.foreground": "#D6D6D6",
    "editorWidget.background": "#FFFFFF",
    "editorWidget.border": "#E0E0E0",
    "editorSuggestWidget.background": "#FFFFFF",
    "editorSuggestWidget.border": "#E0E0E0",
    "editorSuggestWidget.selectedBackground": "#EAF2FB",
    "editorHoverWidget.background": "#FFFFFF",
    "editorHoverWidget.border": "#E0E0E0",
    "editorError.foreground": "#C82829",
    "editorWarning.foreground": "#EAB700",
  },
};

export function defineLangwatchThemes(monacoNs: {
  editor: {
    defineTheme: (name: string, data: editor.IStandaloneThemeData) => void;
  };
}): void {
  monacoNs.editor.defineTheme(MONACO_THEME_DARK, monokaiTheme);
  monacoNs.editor.defineTheme(MONACO_THEME_LIGHT, lightTheme);
}

export function themeNameForColorMode(colorMode: "light" | "dark"): string {
  return colorMode === "dark" ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
