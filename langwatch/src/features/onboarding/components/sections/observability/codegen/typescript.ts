import { platformToFileName } from "../constants";
import { TS_SNIPPETS } from "./snippets.ts";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

export function getTypeScriptLanguageCode(): CodegenResult {
  const s = TS_SNIPPETS.base;
  return {
    code: s.code,
    filename: platformToFileName("typescript"),
    highlightLines: s.highlightLines,
    codeLanguage: "typescript",
  };
}

export function getTypeScriptVercelAICode(): CodegenResult {
  const s = TS_SNIPPETS.vercel_ai;
  return {
    code: s.code,
    filename: platformToFileName("typescript"),
    highlightLines: s.highlightLines,
    codeLanguage: "typescript",
  };
}


