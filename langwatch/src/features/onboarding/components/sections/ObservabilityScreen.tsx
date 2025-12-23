import { Box, Button, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type React from "react";
import { useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
import { Tooltip } from "../../../../components/ui/tooltip";
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
  const router = useRouter();
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
      // Platform has no frameworks, clear framework selection
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
        gap={{ base: 6, xl: 32 }}
        alignItems="start"
        mb={20}
      >
        <VStack align="stretch" gap={6}>
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

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Tooltip
            content="Continue to LangWatch — skip onboarding"
            positioning={{ placement: "left" }}
            showArrow
            openDelay={0}
          >
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              aria-label="Continue to LangWatch"
              borderRadius="full"
              variant="ghost"
              colorPalette="gray"
              bg="whiteAlpha.50"
              _hover={{ bg: "whiteAlpha.100", transform: "translateY(-1px)" }}
              borderWidth="1px"
              borderColor="whiteAlpha.200"
              backdropFilter="blur(10px)"
              style={{ WebkitBackdropFilter: "blur(10px)" }}
              boxShadow="0 4px 18px rgba(2, 1, 1, 0.14), inset 0 1px 0 rgba(255,255,255,0.18)"
              px={{ base: 2, md: 4 }}
              py={2}
            >
              <HStack gap={{ base: 0, md: 2 }}>
                <Text display={{ base: "none", md: "inline" }}>
                  Continue to LangWatch
                </Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
