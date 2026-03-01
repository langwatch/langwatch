import { Button, VStack } from "@chakra-ui/react";
import { WandSparkles } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { toaster } from "../../../../../components/ui/toaster";
import { useCodegen } from "../../../regions/observability/codegen";
import { generateLLMIntegrationPrompt } from "../../../regions/observability/codegen/llm-integration";
import { getRegistryEntry } from "../../../regions/observability/codegen/registry";
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
      instrumentationCode: codegenResult.instrumentation?.code,
      runCommand: codegenResult.runCommand,
    });
  }, [platform, framework, codegenResult]);

  if (!codegenResult) {
    console.error(
      "No snippets found for platform and framework",
      platform,
      framework,
    );

    return null;
  }

  const { code, filename, codeLanguage, highlightLines, instrumentation, runCommand } =
    codegenResult;

  async function copyLLMPrompt(): Promise<void> {
    if (!llmPrompt) return;

    try {
      await navigator.clipboard.writeText(llmPrompt);
      toaster.create({
        title: "Copied AI integration prompt",
        description: "Integration prompt copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  return (
    <VStack gap={3} align="stretch" width="100%">
      {instrumentation && (
        <CodePreview
          code={instrumentation.code}
          filename={instrumentation.filename}
          codeLanguage={instrumentation.codeLanguage}
          highlightLines={instrumentation.highlightLines}
          languageIconUrl={languageIconUrl}
        />
      )}
      <CodePreview
        code={code}
        filename={filename}
        codeLanguage={codeLanguage}
        highlightLines={highlightLines}
        languageIconUrl={languageIconUrl}
      />
      {runCommand && (
        <CodePreview
          code={runCommand}
          filename="terminal"
          codeLanguage="bash"
        />
      )}
      {llmPrompt && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyLLMPrompt()}
          background="linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.15), rgba(236,72,153,0.1))"
          borderWidth="1px"
          borderColor="rgba(139,92,246,0.3)"
          boxShadow="0 0 20px rgba(139,92,246,0.15), 0 0 40px rgba(59,130,246,0.1)"
          _hover={{
            boxShadow:
              "0 0 25px rgba(139,92,246,0.25), 0 0 50px rgba(59,130,246,0.15)",
            borderColor: "rgba(139,92,246,0.5)",
          }}
          transition="all 0.3s ease"
          width="100%"
        >
          <WandSparkles size={16} />
          Copy AI integration prompt
        </Button>
      )}
    </VStack>
  );
}
