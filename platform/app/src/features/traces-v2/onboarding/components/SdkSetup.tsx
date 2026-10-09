/**
 * Direct-SDK setup body: the platform and framework picker, and the
 * code for whatever the reader picks. The access token and project id
 * are already in the env block above it, so this body carries no
 * credentials of its own.
 *
 * Both surfaces render it: the integrate pane opens it from "See SDK
 * instructions", and the integrate drawer holds it on its SDK tab.
 */
import { Box, Grid, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo, useState } from "react";
import { DocsLinks } from "~/features/onboarding/components/sections/observability/DocsLinks";
import { FrameworkGrid } from "~/features/onboarding/components/sections/observability/FrameworkGrid";
import { FrameworkIntegrationCode } from "~/features/onboarding/components/sections/observability/FrameworkIntegrationCode";
import { InstallPreview } from "~/features/onboarding/components/sections/observability/InstallPreview";
import { PlatformGrid } from "~/features/onboarding/components/sections/observability/PlatformGrid";
import { getRegistryEntry } from "~/features/onboarding/regions/observability/codegen/registry";
import type {
  FrameworkKey,
  PlatformKey,
} from "~/features/onboarding/regions/observability/types";
import {
  FRAMEWORKS_BY_PLATFORM,
  PLATFORM_OPTIONS,
} from "~/features/onboarding/regions/observability/ui-options";

export function SdkSetup(): React.ReactElement | null {
  const initialPlatform = PLATFORM_OPTIONS[0]?.key ?? null;
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey | null>(
    initialPlatform,
  );
  const [selectedFramework, setSelectedFramework] =
    useState<FrameworkKey | null>(
      initialPlatform
        ? (FRAMEWORKS_BY_PLATFORM[initialPlatform]?.[0]?.key ?? null)
        : null,
    );

  const hasFrameworks = selectedPlatform
    ? (FRAMEWORKS_BY_PLATFORM[selectedPlatform]?.length ?? 0) > 0
    : false;

  const selectedEntry = useMemo(
    () =>
      selectedPlatform
        ? getRegistryEntry(
            selectedPlatform,
            hasFrameworks ? (selectedFramework ?? undefined) : undefined,
          )
        : undefined,
    [selectedPlatform, selectedFramework, hasFrameworks],
  );

  if (!selectedPlatform) return null;

  function handleSelectPlatform(platform: PlatformKey): void {
    setSelectedPlatform(platform);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[platform]?.[0]?.key;
    setSelectedFramework(firstFramework ?? null);
  }

  return (
    <Grid
      templateColumns={{ base: "1fr", xl: "1fr 1fr" }}
      gap={{ base: 6, xl: 10 }}
      alignItems="start"
    >
      <VStack align="stretch" gap={6} overflow="visible">
        <PlatformGrid
          selectedLanguage={selectedPlatform}
          onSelectLanguage={handleSelectPlatform}
        />

        {hasFrameworks && (
          <FrameworkGrid
            language={selectedPlatform}
            selectedFramework={selectedFramework}
            onSelectFramework={setSelectedFramework}
          />
        )}
      </VStack>

      <VStack align="stretch" gap={3} minW={0} width="full">
        {selectedEntry?.customComponent ? (
          <>
            <selectedEntry.customComponent />
            <DocsLinks
              docs={selectedEntry?.docs}
              label={selectedEntry?.label ?? ""}
            />
          </>
        ) : (
          <>
            <InstallPreview install={selectedEntry?.install} />
            <Box minW={0} width="full" overflowX="auto">
              <FrameworkIntegrationCode
                platform={selectedPlatform}
                framework={selectedFramework as FrameworkKey}
                languageIconUrl={
                  PLATFORM_OPTIONS.find((p) => p.key === selectedPlatform)
                    ?.iconUrl
                }
              />
            </Box>
            <DocsLinks
              docs={selectedEntry?.docs}
              label={selectedEntry?.label ?? ""}
            />
          </>
        )}
      </VStack>
    </Grid>
  );
}
