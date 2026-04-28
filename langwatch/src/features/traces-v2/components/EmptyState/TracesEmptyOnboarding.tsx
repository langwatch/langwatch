import {
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Spinner,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Play } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { DocsLinks } from "~/features/onboarding/components/sections/observability/DocsLinks";
import { FrameworkGrid } from "~/features/onboarding/components/sections/observability/FrameworkGrid";
import { FrameworkIntegrationCode } from "~/features/onboarding/components/sections/observability/FrameworkIntegrationCode";
import { InstallPreview } from "~/features/onboarding/components/sections/observability/InstallPreview";
import { PlatformGrid } from "~/features/onboarding/components/sections/observability/PlatformGrid";
import { ViaClaudeCodeScreen } from "~/features/onboarding/components/sections/ViaClaudeCodeScreen";
import { ViaMcpClientScreen } from "~/features/onboarding/components/sections/ViaClaudeDesktopScreen";
import {
  type ActiveProjectContextValue,
  ActiveProjectProvider,
} from "~/features/onboarding/contexts/ActiveProjectContext";
import { getRegistryEntry } from "~/features/onboarding/regions/observability/codegen/registry";
import type {
  FrameworkKey,
  PlatformKey,
} from "~/features/onboarding/regions/observability/types";
import {
  FRAMEWORKS_BY_PLATFORM,
  PLATFORM_OPTIONS,
} from "~/features/onboarding/regions/observability/ui-options";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { useFilterStore } from "../../stores/filterStore";
import { PatIntegrationInfoCard } from "./PatIntegrationInfoCard";
import { useSampleData } from "./useSampleData";

const SAMPLE_QUERY = "origin:sample";

type Segment = "coding-agent" | "mcp" | "manually";

const SEGMENTS: { value: Segment; label: string; description: string }[] = [
  {
    value: "coding-agent",
    label: "Via Coding Agent",
    description:
      "Set up with prompts, skills, or MCP. Works with Claude Code, Cursor, Windsurf, and more",
  },
  {
    value: "mcp",
    label: "Via MCP",
    description:
      "Connect any MCP client — Claude Desktop, ChatGPT, Cursor, Windsurf, and more",
  },
  {
    value: "manually",
    label: "Manually",
    description: "Integrate the LangWatch SDK directly into your codebase",
  },
];

/**
 * Empty-state onboarding for the new Traces page. Mints a Personal Access
 * Token first, then surfaces three setup paths lifted from the existing
 * onboarding flow:
 *   - "Via Coding Agent" → ViaClaudeCodeScreen (Prompts / Skills / MCP tabs)
 *   - "Via MCP"          → ViaMcpClientScreen (Claude Desktop + ChatGPT)
 *   - "Manually"         → PlatformGrid + FrameworkGrid + code preview
 *
 * The PAT is generated once at the top of the page and propagated to every
 * tab via `ActiveProjectProvider`: we override the project's `apiKey` with
 * the PAT so the lifted screens (which already read `project.apiKey`) pick
 * it up unmodified. `LANGWATCH_PROJECT_ID` is plumbed through MCP config
 * builders so the PAT-aware ingestion auth has everything it needs.
 */
export function TracesEmptyOnboarding(): React.ReactElement {
  const router = useRouter();
  const { project, organization } = useOrganizationTeamProject();
  const [token, setToken] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("coding-agent");
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const sampleData = useSampleData({
    apiKey: token ?? undefined,
    projectId: project?.id,
  });

  if (!project || !organization) {
    return (
      <VStack flex={1} justify="center" align="center" padding={8}>
        <Text color="fg.muted">Loading project…</Text>
      </VStack>
    );
  }

  const handleLoadSample = async () => {
    const ok = await sampleData.load();
    if (!ok) return;
    // Pre-seed the filter so the trace view lands directly on the sample
    // origin once we strip `?empty`. URLSync round-trips this into the
    // fragment on the next render.
    applyQueryText(SAMPLE_QUERY);
    const { empty: _drop, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, {
      shallow: true,
    });
  };

  // Override project.apiKey with the freshly-minted PAT so every lifted
  // onboarding screen renders with the new credential. We don't mutate the
  // upstream object — just synthesize a new context value.
  const activeProjectContext: ActiveProjectContextValue = {
    project: token ? { ...project, apiKey: token } : project,
    organization,
  };

  const activeSegment =
    SEGMENTS.find((s) => s.value === segment) ?? SEGMENTS[0];

  return (
    <ActiveProjectProvider value={activeProjectContext}>
      <VStack
        align="stretch"
        gap={6}
        width="full"
        maxWidth="1200px"
        marginX="auto"
        paddingX={{ base: 4, md: 8 }}
        paddingY={{ base: 6, md: 10 }}
      >
        <VStack align="stretch" gap={2}>
          <Heading size="lg">Send your first trace</Heading>
          <Text color="fg.muted" textStyle="sm">
            Generate an access token, then pick a setup style. Traces will start
            appearing here once your app sends them.
          </Text>
        </VStack>

        <PatIntegrationInfoCard
          organizationId={organization.id}
          projectId={project.id}
          token={token}
          onTokenGenerated={setToken}
        />

        {token && (
          <HStack
            justify="space-between"
            align="center"
            paddingY={2}
            paddingX={3}
            borderRadius="md"
            bg="bg.subtle"
          >
            <VStack align="start" gap={0}>
              <Text textStyle="sm" fontWeight="medium">
                Want to look around first?
              </Text>
              <Text textStyle="xs" color="fg.muted">
                We&apos;ll write a batch of synthetic traces into this project
                so you can poke at the UI immediately.
              </Text>
            </VStack>
            <Button
              size="sm"
              variant="outline"
              colorPalette="orange"
              onClick={() => void handleLoadSample()}
              loading={sampleData.loading}
            >
              {sampleData.loading ? <Spinner size="xs" /> : <Play size={14} />}
              Seed sample traces
            </Button>
          </HStack>
        )}

        {/*
         * Lock the setup paths behind PAT generation: render the tabs
         * regardless so the user sees a teaser of what's coming, but blur
         * + disable interaction until a token exists. The PAT card above
         * is the only call-to-action while locked.
         */}
        <Box
          position="relative"
          {...(!token && {
            filter: "blur(4px)",
            opacity: 0.55,
            pointerEvents: "none" as const,
            userSelect: "none" as const,
            "aria-hidden": "true",
            inert: "",
          })}
          transition="filter 0.25s ease, opacity 0.25s ease"
        >
          <Tabs.Root
            value={segment}
            onValueChange={(e) => setSegment(e.value as Segment)}
            variant="line"
            size="sm"
            colorPalette="orange"
          >
            <Tabs.List>
              {SEGMENTS.map((s) => (
                <Tabs.Trigger key={s.value} value={s.value}>
                  {s.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Box paddingTop={3} paddingBottom={5}>
              <Text color="fg.muted" textStyle="xs" lineHeight="tall">
                {activeSegment?.description ?? ""}
              </Text>
            </Box>

            <Tabs.Content value="coding-agent" padding={0}>
              {/*
               * Drop the MCP sub-tab here — MCP setup has its own
               * top-level "Via MCP" tab in this flow, so duplicating it
               * inside Coding Agent would just be noise.
               */}
              <ViaClaudeCodeScreen showMcpTab={false} />
            </Tabs.Content>
            <Tabs.Content value="mcp" padding={0}>
              <ViaMcpClientScreen />
            </Tabs.Content>
            <Tabs.Content value="manually" padding={0}>
              <ManualSetup />
            </Tabs.Content>
          </Tabs.Root>
        </Box>
      </VStack>
    </ActiveProjectProvider>
  );
}

/**
 * Direct-SDK setup body. The PAT and project id are already pre-filled in
 * the env block at the top of the page, so this body just shows the
 * platform/framework picker and the matching code snippet.
 */
function ManualSetup(): React.ReactElement | null {
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

  if (!selectedPlatform) return null;

  function handleSelectPlatform(platform: PlatformKey): void {
    setSelectedPlatform(platform);
    const firstFramework = FRAMEWORKS_BY_PLATFORM[platform]?.[0]?.key;
    setSelectedFramework(firstFramework ?? null);
  }

  const hasFrameworks =
    (FRAMEWORKS_BY_PLATFORM[selectedPlatform]?.length ?? 0) > 0;

  const selectedEntry = useMemo(
    () =>
      getRegistryEntry(
        selectedPlatform,
        hasFrameworks ? (selectedFramework ?? undefined) : undefined,
      ),
    [selectedPlatform, selectedFramework, hasFrameworks],
  );

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
