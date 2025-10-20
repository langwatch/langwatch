import React from "react";
import type { FrameworkKey, PlatformKey } from "./types";
import { useCodegen } from "../../../codegen";
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
  const { code, filename, codeLanguage, highlightLines } = useCodegen(platform as any, framework as any);

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


