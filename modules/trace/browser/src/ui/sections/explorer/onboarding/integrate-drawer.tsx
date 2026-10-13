import {
  type PersonalTokenMint,
  PROJECT_READ_PERMISSIONS,
  useMintPersonalToken,
} from "@langwatch/api-key-client";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { AggregateReadOnlyNotice } from "@langwatch/error-views";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import type React from "react";
import { useEffect, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";

import { useLangyStore } from "../../../../behavior/langy/langy.store.ts";
import { useOptionalTraceHost } from "../../../../behavior/trace-host.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { SdkSetup } from "../../../elements/explorer/onboarding/sdk-setup.tsx";
import {
  type ActiveProjectContextValue,
  ActiveProjectProvider,
} from "../../onboarding/active-project-context.tsx";
import {
  PromptList,
  SkillList,
  TRACING_SKILL_ID,
} from "../../onboarding/via-claude-code-screen.tsx";
import { ViaMcpClientScreen } from "../../onboarding/via-claude-desktop-screen.tsx";
import { ApiKeyIntegrationInfoCard } from "./api-key-integration-info-card.tsx";

export type Segment = "skill" | "mcp" | "prompt" | "sdk";

interface SegmentDef {
  value: Segment;
  label: string;
  shortcut: string;
  description: string;
}

const SEGMENTS: SegmentDef[] = [
  {
    value: "skill",
    label: "Skills",
    shortcut: "S",
    description: "Reusable slash commands you can invoke from your coding agent.",
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
 * Side drawer that hosts the integration journey: mint a token, then pick a path.
 * Triggered from the empty state's "Integrate" CTA.
 */
export function IntegrateDrawer({
  open,
  onOpenChange,
}: IntegrateDrawerProps): React.ReactElement | null {
  const { project, organization } = useOrganizationTeamProject();
  const tokenScope = {
    organizationId: organization?.id,
    projectId: project?.id,
    userId: useOptionalTraceHost()?.currentUser()?.id,
  };
  // Two tokens, each minted only on its own click: ingestion for `.env`, project reads for MCP.
  const minting = useMintPersonalToken({ ...tokenScope, name: "Personal access token" });
  const mcpMinting = useMintPersonalToken({
    ...tokenScope,
    name: "MCP access token",
    permissions: PROJECT_READ_PERMISSIONS,
  });
  const [segment, setSegment] = useState<Segment>("skill");
  const floatingLangyOpen = useLangyStore((s) => s.isOpen && s.panelMode === "floating");
  const [waitForFloatingLangy] = useState(() => floatingLangyOpen);

  if (!project || !organization) return null;

  const activeProjectContext: ActiveProjectContextValue = {
    project,
    organization,
    freshToken: minting.token,
    mcpMinting,
  };

  return (
    <Drawer
      open={open}
      onClose={() => onOpenChange(false)}
      size="xl"
      title="Send your own traces"
      subtitle="Create a token, then pick how you want to integrate."
      companionMotion={waitForFloatingLangy ? "wait" : "follow"}
    >
      {/* An aggregate (ADR-177) is never sent traces and owns no key,
          so the drawer mints nothing on it. */}
      {isAggregateProjectKind(project.kind) ? (
        <AggregateReadOnlyNotice />
      ) : (
        <ActiveProjectProvider value={activeProjectContext}>
          <IntegrationContent
            projectId={project.id}
            minting={minting}
            segment={segment}
            onSegmentChange={setSegment}
            enabled={open}
          />
        </ActiveProjectProvider>
      )}
    </Drawer>
  );
}

/** What a segment shows: the lifted onboarding screens, unchanged. */
function SegmentPanel({ segment }: { segment: Segment }): React.ReactElement {
  switch (segment) {
    case "mcp":
      return <ViaMcpClientScreen />;
    case "skill":
      // Traces onboarding leads with tracing — that's the job here.
      return <SkillList primarySkillId={TRACING_SKILL_ID} />;
    case "prompt":
      return <PromptList primarySkillId={TRACING_SKILL_ID} />;
    case "sdk":
      return <SdkSetup />;
  }
}

/**
 * Body of the integration journey — extracted from the drawer so the full-screen
 * `IntegratePane` (no-traces page) can render the same content inline without
 * re-implementing the API-key-then-tab pattern.
 */
interface IntegrationContentProps {
  projectId: string;
  minting: PersonalTokenMint;
  segment: Segment;
  onSegmentChange: (segment: Segment) => void;
  /**
   * When false, the S/M/P/D keyboard shortcuts are suppressed. The drawer passes
   * `enabled={open}` so shortcuts only fire while the drawer is open.
   */
  enabled?: boolean;
}

function IntegrationContent({
  projectId,
  minting,
  segment,
  onSegmentChange,
  enabled = true,
}: IntegrationContentProps): React.ReactElement {
  // Tab letter shortcuts (S/M/P/D) fire whenever this component is
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
    // Namespaces the analytics events the lifted onboarding sections emit
    // (prompt/skill/config copies) when they render on this surface.
    <AnalyticsBoundary name="traces_integrate">
      <VStack align="stretch" gap={6}>
        {/* API key generator at the top — minting a token is the first
            step of integration. The lifted onboarding screens below
            read the token via ActiveProjectProvider, so they
            automatically pick up the freshly-scoped credential. */}
        <ApiKeyIntegrationInfoCard projectId={projectId} minting={minting} />

        <Box>
          <Text textStyle="xs" color="fg.muted" marginBottom={2}>
            All four end up in the same explorer.
          </Text>
          <ContentTabs
            label="Integration method"
            value={segment}
            onValueChange={({ value }) => onSegmentChange(value)}
            body="flush"
            mount="all"
            items={SEGMENTS.map((s) => ({
              value: s.value,
              label: s.label,
              shortcut: s.shortcut,
              content: (
                <>
                  <Box paddingTop={3} paddingBottom={4}>
                    <Text
                      color="fg"
                      textStyle="md"
                      fontWeight="medium"
                      letterSpacing="-0.01em"
                      lineHeight="snug"
                    >
                      {s.description}
                    </Text>
                  </Box>
                  <SegmentPanel segment={s.value} />
                </>
              ),
            }))}
          />
        </Box>
      </VStack>
    </AnalyticsBoundary>
  );
}
