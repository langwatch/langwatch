/** How the code editor presents one source language: Monaco mode, tab label, completion hints. */
export interface CodeEditorLanguage {
  monacoLanguage: "python" | "javascript";
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

/** Anything other than "javascript" (including no language at all) edits as Python. */
export function codeEditorLanguage({ language }: { language: string | undefined }) {
  return language === "javascript" ? JAVASCRIPT : PYTHON;
}
