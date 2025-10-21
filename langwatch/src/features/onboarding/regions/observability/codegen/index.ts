import type { FrameworkKey, PlatformKey } from "../model.ts";
import { useActiveProject } from "../../../contexts/ActiveProjectContext.tsx";
import { parseSnippet } from "./snippets.ts";
import { getRegistryEntry } from "./registry.tsx";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

function getFrameworkCode(
  language: PlatformKey,
  framework: FrameworkKey,
): CodegenResult | null {
  const entry = getRegistryEntry(language, framework);
  if (entry?.snippet) {
    const parsed = parseSnippet(entry.snippet.file as unknown as string);
    return {
      code: parsed.code,
      filename: entry.snippet.filename,
      codeLanguage: entry.snippet.language,
      highlightLines: parsed.highlightLines,
    };
  }

  return null;
}

// React hook wrapper that injects project-specific substitutions
export function useCodegen(
  language: PlatformKey,
  framework: FrameworkKey,
): CodegenResult | null {
  const { project } = useActiveProject();
  const projectName = project?.name ?? "my-llm-app";
  const base = getFrameworkCode(language, framework);
  if (!base) return null;

  return { ...base, code: base.code.replaceAll("<project_name>", projectName) };
}
