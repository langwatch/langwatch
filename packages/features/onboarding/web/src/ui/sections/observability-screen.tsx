import { Box, Grid, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo, useState } from "react";
import { getRegistryEntry } from "./observability/codegen/registry";
import type { FrameworkKey, PlatformKey } from "../../model/observability/types";
import {
  FRAMEWORKS_BY_PLATFORM,
  PLATFORM_OPTIONS,
} from "./observability/ui-options";
import { ApiIntegrationInfoCard } from "./observability/api-integration-info-card";
import { DocsLinks } from "../blocks/observability/docs-links";
import { FrameworkGrid } from "./observability/framework-grid";
import { FrameworkIntegrationCode } from "./observability/framework-integration-code";
import { InstallPreview } from "./observability/install-preview";
import { PlatformGrid } from "./observability/platform-grid";
import { WaitingForTracesChip } from "./observability/waiting-for-traces-chip";

export function ObservabilityScreen(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>("typescript");
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey>("vercel_ai");

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
              <DocsLinks docs={selectedEntry?.docs} label={selectedEntry?.label ?? ""} />
            </>
          ) : (
            <VStack align="stretch" gap={3} minW={0} w="full">
              <InstallPreview install={selectedEntry?.install} />
              <Box minW={0} w="full" overflowX="auto">
                <FrameworkIntegrationCode
                  platform={selectedPlatform}
                  framework={selectedFramework}
                  languageIconUrl={
                    PLATFORM_OPTIONS.find((l) => l.key === selectedPlatform)?.iconUrl
                  }
                />
              </Box>
              <DocsLinks docs={selectedEntry?.docs} label={selectedEntry?.label ?? ""} />
            </VStack>
          )}
        </VStack>
      </Grid>

      <WaitingForTracesChip />
    </>
  );
}
