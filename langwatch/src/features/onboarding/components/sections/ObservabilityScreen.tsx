import { Box, Grid, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo, useState } from "react";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { getRegistryEntry } from "../../regions/observability/codegen/registry";
import type {
  FrameworkKey,
  PlatformKey,
} from "../../regions/observability/types";
import {
  FRAMEWORKS_BY_PLATFORM,
  PLATFORM_OPTIONS,
} from "../../regions/observability/ui-options";
import { ApiIntegrationInfoCard } from "./observability/ApiIntegrationInfoCard";
import { DocsLinks } from "./observability/DocsLinks";
import { FrameworkGrid } from "./observability/FrameworkGrid";
import { FrameworkIntegrationCode } from "./observability/FrameworkIntegrationCode";
import { InstallPreview } from "./observability/InstallPreview";
import { PlatformGrid } from "./observability/PlatformGrid";
import { WaitingForTracesChip } from "./observability/WaitingForTracesChip";

export function ObservabilityScreen(): React.ReactElement {
  const { project } = useActiveProject();
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] =
    useState<FrameworkKey>("vercel_ai");

  function handleSelectLanguage(lang: PlatformKey): void {
    setSelectedPlatform(lang);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[lang]?.[0]?.key;
    if (firstFramework) {
      setSelectedFramework(firstFramework);
    } else {
      setSelectedFramework(null as any);
    }
  }

  const hasFrameworks = useMemo(() => {
    return FRAMEWORKS_BY_PLATFORM[selectedPlatform]?.length > 0;
  }, [selectedPlatform]);

  const selectedEntry = useMemo(() => {
    return getRegistryEntry(
      selectedPlatform,
      hasFrameworks ? selectedFramework : undefined,
    );
  }, [selectedPlatform, selectedFramework, hasFrameworks]);

  return (
    <>
      <Grid
        templateColumns={{ base: "1fr", xl: "1fr 1fr" }}
        gap={{ base: 6, xl: 10 }}
        alignItems="start"
        mb={20}
      >
        <VStack align="stretch" gap={8} overflow="visible">
          <PlatformGrid
            selectedLanguage={selectedPlatform}
            onSelectLanguage={handleSelectLanguage}
          />

          {hasFrameworks && (
            <FrameworkGrid
              language={selectedPlatform}
              selectedFramework={selectedFramework}
              onSelectFramework={setSelectedFramework}
            />
          )}

          <ApiIntegrationInfoCard />
        </VStack>

        <VStack align="stretch" gap={3} minW={0} w="full">
          {selectedEntry?.customComponent ? (
            <>
              <selectedEntry.customComponent />
              <DocsLinks
                docs={selectedEntry?.docs}
                label={selectedEntry?.label ?? ""}
              />
            </>
          ) : (
            <VStack align="stretch" gap={3} minW={0} w="full">
              <InstallPreview install={selectedEntry?.install} />
              <Box minW={0} w="full" overflowX="auto">
                <FrameworkIntegrationCode
                  platform={selectedPlatform}
                  framework={selectedFramework}
                  languageIconUrl={
                    PLATFORM_OPTIONS.find((l) => l.key === selectedPlatform)
                      ?.iconUrl
                  }
                />
              </Box>
              <DocsLinks
                docs={selectedEntry?.docs}
                label={selectedEntry?.label ?? ""}
              />
            </VStack>
          )}
        </VStack>
      </Grid>

      <WaitingForTracesChip />
    </>
  );
}
