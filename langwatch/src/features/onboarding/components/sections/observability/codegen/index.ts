import type { FrameworkKey, PlatformKey } from "../types";
import type { GoFrameworkKey } from "../constants";
import { platformToFileName } from "../constants";
import { TS_SNIPPETS } from "./snippets.ts";
import { getGoFrameworkCode, getGoLanguageCode } from "./go.ts";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

export function getLanguageCode(language: PlatformKey): CodegenResult {
  switch (language) {
    case "typescript": {
      const s = TS_SNIPPETS.base;
      return { code: s.code, filename: platformToFileName(language), highlightLines: s.highlightLines, codeLanguage: "typescript" };
    }
    case "go":
      return getGoLanguageCode();
    case "python":
      return { code: "# Integration snippet coming soon\n# Language: Python\n# Framework: None selected", filename: platformToFileName(language), codeLanguage: "python" };
    case "opentelemetry":
      return { code: "# Integration snippet coming soon\n# Language: OpenTelemetry\n# Framework: None selected", filename: platformToFileName(language), codeLanguage: "yaml" };
    default:
      return { code: "", filename: "", codeLanguage: "" } as CodegenResult;
  }
}

// Overloads to ensure only GoFrameworkKey is accepted when language is "go"
export function getFrameworkCode(language: "go", framework: GoFrameworkKey): CodegenResult;
export function getFrameworkCode(language: Exclude<PlatformKey, "go">, framework: FrameworkKey): CodegenResult;

export function getFrameworkCode(language: PlatformKey, framework: FrameworkKey): CodegenResult {
  if (language === "go") {
    return getGoFrameworkCode(framework as GoFrameworkKey);
  }
  if (language === "typescript" && framework === "vercel_ai") {
    return getLanguageCode("typescript");
  }

  const base = getLanguageCode(language);
  const prefix = ["typescript", "go"].includes(language) ? "//" : "#";
  const frameworkLabel = framework.replaceAll("_", " ");
  return {
    code: `${prefix} Integration snippet coming soon\n${prefix} Language: ${capitalize(language)}\n${prefix} Framework: ${capitalize(frameworkLabel)}`,
    filename: base.filename,
    codeLanguage: base.codeLanguage,
  };
}

function capitalize(input: string): string {
  return input.length ? input.charAt(0).toUpperCase() + input.slice(1) : input;
}


