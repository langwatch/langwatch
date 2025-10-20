import type { FrameworkKey, PlatformKey } from "../types";
import type { GoFrameworkKey } from "../constants";
import { useActiveProject } from "../../../../context/ActiveProjectContext";
import { platformToFileName } from "./platform.ts";
import { parseSnippet } from "./snippets.ts";
import { registry, getRegistryEntry } from "./registry";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

export function getLanguageCode(language: PlatformKey): CodegenResult {
  switch (language) {
    case "typescript":
      try {
        // Use base TS snippet
        const base = registry.find((r) => r.platform === "typescript" && r.framework === "openai" && r.snippet)?.snippet;
        if (base?.file) {
          const parsed = parseSnippet(base.file as unknown as string);
          return { code: parsed.code, filename: base.filename, codeLanguage: base.language, highlightLines: parsed.highlightLines };
        }
      } catch {}
      return { code: "", filename: platformToFileName(language), codeLanguage: "typescript" };
    case "go":
      return { code: "// Integration snippet coming soon", filename: platformToFileName(language), codeLanguage: "go" };
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
  // Prefer registry-driven lookup
  const entry = getRegistryEntry(language, framework);
  if (entry?.snippet) {
    const parsed = parseSnippet(entry.snippet.file as unknown as string);
    return { code: parsed.code, filename: entry.snippet.filename, codeLanguage: entry.snippet.language, highlightLines: parsed.highlightLines };
  }
  // Fallback placeholder
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

// React hook wrapper that injects project-specific substitutions
export function useCodegen(language: "go", framework: GoFrameworkKey): CodegenResult;
export function useCodegen(language: Exclude<PlatformKey, "go">, framework: FrameworkKey): CodegenResult;
export function useCodegen(language: PlatformKey, framework: FrameworkKey): CodegenResult {
  const { project } = useActiveProject();
  const projectName = project?.name ?? "my-llm-app";
  const base = language === "go"
    ? getFrameworkCode("go", framework as GoFrameworkKey)
    : getFrameworkCode(language, framework);
  return { ...base, code: base.code.replaceAll("<project_name>", projectName) };
}


