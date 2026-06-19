import type React from "react";
import { useCodegen } from "../../../regions/observability/codegen";
import type {
  FrameworkKey,
  PlatformKey,
} from "../../../regions/observability/types";
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

  if (!codegenResult) {
    console.error(
      "No snippets found for platform and framework",
      platform,
      framework,
    );

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
    />
  );
}
