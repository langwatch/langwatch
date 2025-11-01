import React from "react";
import type { FrameworkKey, PlatformKey } from "../../../regions/observability/model";
import { useCodegen } from "../../../regions/observability/codegen";
import { CodePreview } from "./CodePreview";

export function FrameworkIntegrationCode({
  platform,
  framework,
  languageIcon,
}: {
  platform: PlatformKey;
  framework: FrameworkKey;
  languageIcon?: React.ReactNode;
}): React.ReactElement | null {
  const codegenResult = useCodegen(platform, framework);
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
      languageIcon={languageIcon}
    />
  );
}
