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
import { getFrameworkCode } from "./observability/codegen";
import { FrameworkGrid } from "./observability/FrameworkGrid";
import { PlatformGrid } from "./observability/PlatformGrid";
import { PLATFORM_OPTIONS, FRAMEWORKS_BY_PLATFORM } from "./observability/constants";
import { InstallPreview } from "./observability/InstallPreview";
import { getRegistryEntry } from "./observability/codegen/registry";

export function ObservabilityScreen(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey>("vercel_ai");

  function handleSelectLanguage(lang: PlatformKey): void {
    setSelectedPlatform(lang);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[lang]?.[0]?.key;
    if (firstFramework) {
      setSelectedFramework(firstFramework);
    }
  }

  const codegen = useMemo(() => {
    if (selectedPlatform === "go") return getFrameworkCode("go", selectedFramework );
    return getFrameworkCode(selectedPlatform, selectedFramework);
  }, [selectedPlatform, selectedFramework]);

  const selectedEntry = useMemo(() => {
    return getRegistryEntry(selectedPlatform, selectedFramework);
  }, [selectedPlatform, selectedFramework]);

  const Custom = selectedEntry?.customComponent;

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

      {Custom ? (
        <Custom />
      ) : (
        <VStack align="stretch" gap={3}>
          <InstallPreview install={selectedEntry?.install} />
          <CodePreview
            code={codegen.code}
            filename={codegen.filename}
            codeLanguage={codegen.codeLanguage}
            languageIcon={PLATFORM_OPTIONS.find((l) => l.key === selectedPlatform)?.icon}
            highlightLines={codegen.highlightLines}
          />
        </VStack>
      )}

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
