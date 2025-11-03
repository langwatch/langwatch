import React, { useMemo } from "react";
import type { FrameworkKey, PlatformKey } from "../../../regions/observability/model";
import { useCodegen } from "../../../regions/observability/codegen";
import { getRegistryEntry } from "../../../regions/observability/codegen/registry";
import { CodePreview } from "./CodePreview";

export function FrameworkIntegrationCode({
  platform,
  framework,
  languageIconUrl,
}: {
  platform: PlatformKey;
  framework: FrameworkKey;
  languageIconUrl?: string;
}): React.ReactElement | null {
  const codegenResult = useCodegen(platform, framework);

  const llmPrompt = useMemo(() => {
    if (!codegenResult) return undefined;

    const registryEntry = getRegistryEntry(platform, framework);
    if (!registryEntry) return undefined;

    return generateLLMIntegrationPrompt({
      frameworkLabel: registryEntry.label,
      install: registryEntry.install,
      docs: registryEntry.docs,
      code: codegenResult.code,
      codeLanguage: codegenResult.codeLanguage,
    });
  }, [platform, framework, codegenResult]);

  if (!codegenResult) {
    console.error("No snippets found for platform and framework", platform, framework);

    return null;
  }

  const { code, filename, codeLanguage, highlightLines } = codegenResult;

  return (
    <CodePreview
      code={code}
      filename={filename}
      codeLanguage={codeLanguage}
      highlightLines={highlightLines}
      languageIconUrl={languageIconUrl}
      llmPrompt={llmPrompt}
    />
  );
}
