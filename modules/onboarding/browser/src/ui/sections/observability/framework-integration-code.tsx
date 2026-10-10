import { SnippetPreview } from "@langwatch/design-system/code-preview";
import type React from "react";

import type { FrameworkKey, PlatformKey } from "../../../model/observability/types.ts";
import { useCodegen } from "./codegen/index.ts";

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

  if (!codegenResult) {
    console.error("No snippets found for platform and framework", platform, framework);

    return null;
  }

  const { code, filename, codeLanguage, highlightLines } = codegenResult;

  return (
    <SnippetPreview
      code={code}
      filename={filename}
      codeLanguage={codeLanguage}
      highlightLines={highlightLines}
      languageIconUrl={languageIconUrl}
    />
  );
}
