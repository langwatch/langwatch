import { codeLanguageFrom } from "../code-language.ts";

/** How the code editor presents one source language: Monaco mode, tab label, completion hints. */
export interface CodeEditorLanguage {
  monacoLanguage: "python" | "javascript" | "typescript";
  label: string;
  fileName: string;
  technologies: string[];
  tabSize: number;
}

const PYTHON: CodeEditorLanguage = {
  monacoLanguage: "python",
  label: "Python",
  fileName: "Code.py",
  technologies: ["python", "dspy"],
  tabSize: 4,
};

const JAVASCRIPT: CodeEditorLanguage = {
  monacoLanguage: "javascript",
  label: "JavaScript",
  fileName: "code.mjs",
  technologies: ["javascript"],
  tabSize: 2,
};

const TYPESCRIPT: CodeEditorLanguage = {
  monacoLanguage: "typescript",
  label: "TypeScript",
  fileName: "code.ts",
  technologies: ["typescript"],
  tabSize: 2,
};

const EDITOR_LANGUAGES = { python: PYTHON, javascript: JAVASCRIPT, typescript: TYPESCRIPT };

/** Anything other than JavaScript or TypeScript (including no language at all) edits as Python. */
export function codeEditorLanguage({ language }: { language: string | undefined }) {
  return EDITOR_LANGUAGES[codeLanguageFrom({ value: language })];
}
