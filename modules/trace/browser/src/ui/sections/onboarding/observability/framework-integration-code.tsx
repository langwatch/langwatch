import { SnippetPreview } from "@langwatch/design-system/code-preview";
import { createLogger } from "@langwatch/observability/browser";
import type React from "react";

import type {
  FrameworkKey,
  PlatformKey,
} from "../../../../model/onboarding/observability/types.ts";
import { useCodegen } from "./codegen/index.ts";

const logger = createLogger("langwatch:trace:framework-integration-code");

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
    logger.error({ platform, framework }, "No snippets found for platform and framework");

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
