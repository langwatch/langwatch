import React, { useMemo, useState } from "react";
import { VStack, Grid, Box } from "@chakra-ui/react";
import { WaitingForTracesChip } from "./observability/WaitingForTracesChip";
import type { FrameworkKey, PlatformKey } from "./observability/types";
import { ApiIntegrationInfoCard } from "./observability/ApiIntegrationInfoCard";
import { FrameworkGrid } from "./observability/FrameworkGrid";
import { PlatformGrid } from "./observability/PlatformGrid";
import {
  PLATFORM_OPTIONS,
  FRAMEWORKS_BY_PLATFORM,
} from "./observability/constants";
import { InstallPreview } from "./observability/InstallPreview";
import { getRegistryEntry } from "./observability/codegen/registry";
import { FrameworkIntegrationCode } from "./observability/FrameworkIntegrationCode";

export function ObservabilityScreen(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] =
    useState<FrameworkKey>("vercel_ai");

  function handleSelectLanguage(lang: PlatformKey): void {
    setSelectedPlatform(lang);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[lang]?.[0]?.key;
    if (firstFramework) {
      setSelectedFramework(firstFramework);
    }
  }


  const selectedEntry = useMemo(() => {
    return getRegistryEntry(selectedPlatform, selectedFramework);
  }, [selectedPlatform, selectedFramework]);

  return (
    <>
      <Grid templateColumns={{ base: "1fr", "xl": "1fr 1fr" }} gap={{ base: 6, "xl": 32 }} alignItems="start">
        <VStack align="stretch" gap={6}>
          <PlatformGrid
            selectedLanguage={selectedPlatform}
            onSelectLanguage={handleSelectLanguage}
          />

          <FrameworkGrid
            language={selectedPlatform}
            selectedFramework={selectedFramework}
            onSelectFramework={setSelectedFramework}
          />

          <ApiIntegrationInfoCard />
        </VStack>

        <VStack align="stretch" gap={3} minW={0} w="full">
          {selectedEntry?.customComponent ? (
            <selectedEntry.customComponent />
          ) : (
            <VStack align="stretch" gap={3} minW={0} w="full">
              <InstallPreview install={selectedEntry?.install} />
              <Box minW={0} w="full" overflowX="auto">
                <FrameworkIntegrationCode
                  platform={selectedPlatform}
                  framework={selectedFramework}
                  languageIcon={
                    PLATFORM_OPTIONS.find((l) => l.key === selectedPlatform)?.icon
                  }
                />
              </Box>
            </VStack>
          )}
        </VStack>
      </Grid>

      <WaitingForTracesChip />
    </>
  );
}
