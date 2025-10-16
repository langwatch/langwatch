import React, { useMemo, useState } from "react";
import {
  Alert,
  HStack,
  VStack,
  Spinner,
} from "@chakra-ui/react";
import type { FrameworkKey, PlatformKey } from "./observability/types";
import { ApiKeyCard } from "./observability/ApiKeyCard";
import { CodePreview } from "./observability/CodePreview";
import { getLanguageCode } from "./observability/codegen";
import { FrameworkGrid } from "./observability/FrameworkGrid";
import { PlatformGrid } from "./observability/PlatformGrid";
import { PLATFORM_OPTIONS } from "./observability/constants";


export function ObservabilityScreen(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey | null>(null);
  const codegen = useMemo(() => getLanguageCode(selectedPlatform), [selectedPlatform]);

  return (
    <VStack gap={6} align="stretch">
      <PlatformGrid
        selectedLanguage={selectedPlatform}
        onSelectLanguage={setSelectedPlatform}
      />

      <ApiKeyCard />

      <FrameworkGrid
        language={selectedPlatform}
        selectedFramework={selectedFramework}
        onSelectFramework={setSelectedFramework}
      />

      <CodePreview
        code={codegen.code}
        filename={codegen.filename}
        codeLanguage={codegen.codeLanguage}
        languageIcon={PLATFORM_OPTIONS.find((l) => l.key === selectedPlatform)?.icon}
        highlightLines={codegen.highlightLines}
      />

      <Alert.Root colorPalette="orange" borderStartWidth="4px" borderStartColor="orange.500">
        <Alert.Content>
          <HStack gap={2} align="center">
            <Spinner color="orange.500" borderWidth="2px" animationDuration="0.6s" size="sm" />
            <Alert.Title>Waiting to receive traces...</Alert.Title>
          </HStack>
        </Alert.Content>
      </Alert.Root>
    </VStack>
  );
}
