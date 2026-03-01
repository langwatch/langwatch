import { usePublicEnv } from "~/hooks/usePublicEnv.ts";
import { useActiveProject } from "../../../contexts/ActiveProjectContext.tsx";
import type { FrameworkKey, PlatformKey } from "../types.ts";
import { getRegistryEntry } from "./registry.tsx";
import { parseSnippet } from "./snippets.ts";

interface CodeSnippetResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

interface CodegenResult extends CodeSnippetResult {
  instrumentation?: CodeSnippetResult;
  runCommand?: string;
}

function getFrameworkCode(
  language: PlatformKey,
  framework: FrameworkKey,
): CodegenResult | null {
  const entry = getRegistryEntry(language, framework);
  if (entry?.snippet) {
    const parsed = parseSnippet(entry.snippet.file as unknown as string);
    const result: CodegenResult = {
      code: parsed.code,
      filename: entry.snippet.filename,
      codeLanguage: entry.snippet.language,
      highlightLines: parsed.highlightLines,
      runCommand: entry.runCommand,
    };

    if (entry.instrumentation) {
      const instrParsed = parseSnippet(
        entry.instrumentation.file as unknown as string,
      );
      result.instrumentation = {
        code: instrParsed.code,
        filename: entry.instrumentation.filename,
        codeLanguage: entry.instrumentation.language,
        highlightLines: instrParsed.highlightLines,
      };
    }

    return result;
  }

  return null;
}

// React hook wrapper that injects project-specific substitutions
export function useCodegen(
  language: PlatformKey,
  framework: FrameworkKey,
): CodegenResult | null {
  const publicEnv = usePublicEnv();
  const { project } = useActiveProject();
  const projectName = project?.name ?? "my-llm-app";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST ?? "";

  const base = getFrameworkCode(language, framework);
  if (!base) return null;

  const substitute = (text: string) =>
    text
      .replaceAll("<project_name>", projectName)
      .replaceAll("<project_endpoint>", effectiveEndpoint);

  return {
    ...base,
    code: substitute(base.code),
    instrumentation: base.instrumentation
      ? {
          ...base.instrumentation,
          code: substitute(base.instrumentation.code),
        }
      : undefined,
  };
}
