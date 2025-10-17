import type { GoFrameworkKey } from "../constants";
import { platformToFileName } from "../constants";
import { GO_SNIPPETS } from "./snippets.ts";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

export function getGoLanguageCode(): CodegenResult {
  const s = GO_SNIPPETS.base;
  return {
    code: s.code,
    filename: platformToFileName("go"),
    highlightLines: s.highlightLines,
    codeLanguage: "go",
  };
}

export function getGoFrameworkCode(framework: GoFrameworkKey): CodegenResult {
  const s = GO_SNIPPETS[framework];
  return {
    code: s.code,
    filename: platformToFileName("go"),
    highlightLines: s.highlightLines,
    codeLanguage: "go",
  };
}


