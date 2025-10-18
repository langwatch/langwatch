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
import { getLanguageCode, getFrameworkCode } from "./observability/codegen";
import type { GoFrameworkKey } from "./observability/constants";
import { FrameworkGrid } from "./observability/FrameworkGrid";
import { PlatformGrid } from "./observability/PlatformGrid";
import { PLATFORM_OPTIONS, FRAMEWORKS_BY_PLATFORM } from "./observability/constants";


export function ObservabilityScreen(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey | null>(null);

  function handleSelectLanguage(lang: PlatformKey): void {
    setSelectedPlatform(lang);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[lang]?.[0]?.key ?? null;
    setSelectedFramework(firstFramework);
  }

  const codegen = useMemo(() => {
    if (!selectedFramework) return getLanguageCode(selectedPlatform);
    if (selectedPlatform === "go") return getFrameworkCode("go", selectedFramework as GoFrameworkKey);
    return getFrameworkCode(selectedPlatform, selectedFramework);
  }, [selectedPlatform, selectedFramework]);

  return (
    <VStack gap={6} align="stretch">
      <PlatformGrid
        selectedLanguage={selectedPlatform}
        onSelectLanguage={handleSelectLanguage}
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
