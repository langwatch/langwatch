import { Box, Grid, HStack, Tabs, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Drawer } from "~/components/ui/drawer";
import { DocsLinks } from "~/features/onboarding/components/sections/observability/DocsLinks";
import { FrameworkGrid } from "~/features/onboarding/components/sections/observability/FrameworkGrid";
import { FrameworkIntegrationCode } from "~/features/onboarding/components/sections/observability/FrameworkIntegrationCode";
import { InstallPreview } from "~/features/onboarding/components/sections/observability/InstallPreview";
import { PlatformGrid } from "~/features/onboarding/components/sections/observability/PlatformGrid";
import {
  PromptList,
  SkillList,
} from "~/features/onboarding/components/sections/ViaClaudeCodeScreen";
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
import { ApiKeyIntegrationInfoCard } from "./ApiKeyIntegrationInfoCard";

export type Segment = "skill" | "mcp" | "prompt" | "sdk";

interface SegmentDef {
  value: Segment;
  label: string;
  shortcut: string;
  description: string;
}

export const SEGMENTS: SegmentDef[] = [
  {
    value: "skill",
    label: "Skills",
    shortcut: "S",
    description:
      "Reusable slash commands you can invoke from your coding agent.",
  },
  {
    value: "mcp",
    label: "MCP",
    shortcut: "M",
    description: "Connect LangWatch as an MCP server in any compatible client.",
  },
  {
    value: "prompt",
    label: "Prompt",
    shortcut: "P",
    description: "A one-shot prompt to paste into your coding agent.",
  },
  {
    value: "sdk",
    label: "SDK",
    shortcut: "D",
    description: "Use the LangWatch SDK directly in your codebase.",
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return true;
  return t.isContentEditable;
}

interface IntegrateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Side drawer that hosts the integration journey: mint a token, then
 * pick a path. Triggered from the empty state's "Integrate" CTA.
 *
 * Token generation lives *inside* the drawer (not in the empty-state
 * hero) so the empty state stays a quiet, atmospheric preview while
 * the drawer becomes the focused "I'm doing real setup now" surface.
 *
 * Once minted, the freshly-scoped PAT is plumbed through every path
 * via `ActiveProjectProvider` — every lifted onboarding screen reads
 * `project.apiKey` unmodified and gets the right credential.
 */
export function IntegrateDrawer({
  open,
  onOpenChange,
}: IntegrateDrawerProps): React.ReactElement | null {
  const { project, organization } = useOrganizationTeamProject();
  const [token, setToken] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("skill");

  const activeSegment =
    SEGMENTS.find((s) => s.value === segment) ?? SEGMENTS[0];

  if (!project || !organization) return null;

  const activeProjectContext: ActiveProjectContextValue = {
    project: token ? { ...project, apiKey: token } : project,
    organization,
    freshToken: token ?? undefined,
    onFreshToken: setToken,
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size="xl"
      placement="end"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <VStack align="stretch" gap={1}>
            <Drawer.Title>Send your own traces</Drawer.Title>
            <Text color="fg.muted" textStyle="sm">
              Mint a token, then pick how you want to integrate.
            </Text>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <ActiveProjectProvider value={activeProjectContext}>
            <IntegrationContent
              organizationId={organization.id}
              projectId={project.id}
              token={token}
              onTokenGenerated={setToken}
              segment={segment}
              onSegmentChange={setSegment}
              activeSegmentDescription={activeSegment?.description ?? ""}
              enabled={open}
            />
          </ActiveProjectProvider>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Body of the integration journey — extracted from the drawer so the
 * full-screen `IntegratePane` (no-traces page) can render the same
 * content inline without re-implementing the API-key-then-tab pattern.
 * The drawer wraps this in `Drawer.Body` chrome; the pane wraps it in
 * its own focused layout.
 *
 * State is hoisted out (token, segment, active description) so the
 * parent owns persistence across keyboard shortcut listeners etc.
 */
interface IntegrationContentProps {
  organizationId: string;
  projectId: string;
  token: string | null;
  onTokenGenerated: (token: string) => void;
  segment: Segment;
  onSegmentChange: (segment: Segment) => void;
  activeSegmentDescription: string;
  /**
   * When false, the S/M/P/I keyboard shortcuts are suppressed. The
   * drawer passes `enabled={open}` so shortcuts only fire while the
   * drawer is open. `IntegratePane` omits this prop — it defaults to
   * `true`, so shortcuts are always active when the pane is mounted.
   */
  enabled?: boolean;
}

export function IntegrationContent({
  organizationId,
  projectId,
  token,
  onTokenGenerated,
  segment,
  onSegmentChange,
  activeSegmentDescription,
  enabled = true,
}: IntegrationContentProps): React.ReactElement {
  // Tab letter shortcuts (S/M/P/I) fire whenever this component is
  // active — always for IntegratePane, only while open for the drawer.
  // Suppressed when the user is typing in an input or contentEditable.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const match = SEGMENTS.find((s) => s.shortcut.toLowerCase() === key);
      if (match) {
        e.preventDefault();
        onSegmentChange(match.value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onSegmentChange]);

  return (
    <VStack align="stretch" gap={6}>
      {/* API key generator at the top — minting a token is the first
          step of integration. The lifted onboarding screens below
          read the token via ActiveProjectProvider, so they
          automatically pick up the freshly-scoped credential. */}
      <ApiKeyIntegrationInfoCard
        organizationId={organizationId}
        projectId={projectId}
        token={token}
        onTokenGenerated={onTokenGenerated}
      />

      <Tabs.Root
        value={segment}
        onValueChange={(e) => onSegmentChange(e.value as Segment)}
        variant="line"
        size="sm"
        colorPalette="orange"
      >
        <Text textStyle="xs" color="fg.muted" marginBottom={2}>
          All four end up in the same explorer.
        </Text>
        <Tabs.List>
          {SEGMENTS.map((s) => (
            <Tabs.Trigger key={s.value} value={s.value}>
              <HStack gap={1.5}>
                <Box as="span">{s.label}</Box>
                <Kbd>{s.shortcut}</Kbd>
              </HStack>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Box paddingTop={3} paddingBottom={4}>
          <Text
            color="fg"
            textStyle="md"
            fontWeight="medium"
            letterSpacing="-0.01em"
            lineHeight="snug"
          >
            {activeSegmentDescription}
          </Text>
        </Box>

        <Tabs.Content value="mcp" padding={0}>
          <ViaMcpClientScreen />
        </Tabs.Content>
        <Tabs.Content value="skill" padding={0}>
          <SkillList />
        </Tabs.Content>
        <Tabs.Content value="prompt" padding={0}>
          <PromptList />
        </Tabs.Content>
        <Tabs.Content value="sdk" padding={0}>
          <ManualSetup />
        </Tabs.Content>
      </Tabs.Root>
    </VStack>
  );
}

/**
 * Direct-SDK setup body. Token + project id are already pre-filled in
 * the env block at the top of the drawer, so this body just shows the
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
