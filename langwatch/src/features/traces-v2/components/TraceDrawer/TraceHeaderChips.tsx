import { Avatar, Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Lightbulb } from "lucide-react";
import {
  LuBookMarked,
  LuCircleDashed,
  LuCode,
  LuGlobe,
  LuHistory,
  LuMessageSquare,
  LuServer,
  LuSparkles,
  LuTriangleAlert,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { useConversationTurns } from "../../hooks/useConversationTurns";
import {
  type PromptChipState,
  type SdkInfoLike,
  type TraceHeaderChipData,
  useTraceHeaderChips,
} from "../../hooks/useTraceHeaderChips";
import type { ChipDef } from "./ChipBar";
import { ChipBar } from "./ChipBar";
import { buildScenarioChipDef } from "./ScenarioChip";

interface TraceHeaderChipsProps {
  trace: TraceHeader;
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
  endSlot?: React.ReactNode;
}

/**
 * Renders the trace-drawer header chip strip.
 *
 * Pulls plain data from `useTraceHeaderChips` and turns it into `ChipDef[]`
 * with rendered tooltip JSX. Splitting keeps the hook in `.ts`-land
 * (CLAUDE.md: "Hooks return state and callbacks, never JSX").
 */
export function TraceHeaderChips({
  trace,
  onSelectSpan,
  onOpenPromptsTab,
  endSlot,
}: TraceHeaderChipsProps) {
  const chipDefs = useTraceHeaderChipDefs(trace, {
    onSelectSpan,
    onOpenPromptsTab,
  });
  return <ChipBar chips={chipDefs} endSlot={endSlot} />;
}

/**
 * Hook variant of `TraceHeaderChips`: returns the resolved `ChipDef[]` so
 * callers can inline-render alongside other content (e.g. unified context
 * strip in the drawer header) instead of being forced through `ChipBar`.
 * Always run `useAnnotationsChip` so hook order stays stable across renders.
 */
export function useTraceHeaderChipDefs(
  trace: TraceHeader,
  callbacks: {
    onSelectSpan: (spanId: string) => void;
    onOpenPromptsTab: () => void;
  },
): ChipDef[] {
  const { chips } = useTraceHeaderChips(trace, callbacks);

  const chipDefs: ChipDef[] = chips
    .map((c, idx): ChipDef | null => buildChipDef(c, idx, callbacks))
    .filter((c): c is ChipDef => c != null);

  const annotationsChip = useAnnotationsChip(trace);
  if (annotationsChip) chipDefs.push(annotationsChip);

  return chipDefs;
}

/**
 * Header chip listing annotations on this trace + every other turn in the
 * same conversation. Hidden when there are zero. Click to peek at the list;
 * clicking an entry doesn't edit (kept lightweight) — the conversation
 * view's Annotations mode is the place for editing the rollup.
 */
function useAnnotationsChip(trace: TraceHeader): ChipDef | null {
  const { project, hasPermission } = useOrganizationTeamProject();
  const conversation = useConversationTurns(trace.conversationId ?? null);
  const traceIds = [
    trace.traceId,
    ...(conversation.data?.items ?? [])
      .map((t) => t.traceId)
      .filter((id) => id !== trace.traceId),
  ];

  const annotations = api.annotation.getByTraceIds.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled:
        !!project?.id &&
        traceIds.length > 0 &&
        hasPermission("annotations:view"),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const items = annotations.data ?? [];
  if (items.length === 0) return null;
  const hasCorrection = items.some((a) => a.expectedOutput);

  return {
    id: "annotations",
    label: "Annotations",
    value: String(items.length),
    icon: LuMessageSquare,
    tone: "yellow",
    priority: 1,
    popover: (
      <VStack
        align="stretch"
        gap={3}
        minWidth="300px"
        maxWidth="380px"
        paddingX={3}
        paddingY={2.5}
      >
        <HStack gap={2}>
          <Text textStyle="xs" fontWeight="600">
            {items.length} annotation{items.length === 1 ? "" : "s"}
          </Text>
          {hasCorrection && (
            <HStack gap={1} color="yellow.fg">
              <Icon as={Lightbulb} boxSize={3} />
              <Text textStyle="2xs">includes corrections</Text>
            </HStack>
          )}
        </HStack>
        <Box height="1px" bg="border.muted" marginX={-3} />
        <VStack align="stretch" gap={3} maxHeight="280px" overflowY="auto">
          {items.map((a) => (
            <HStack key={a.id} gap={2.5} align="start">
              <Avatar.Root size="xs" background="gray.solid" color="white">
                <Avatar.Fallback name={a.user?.name ?? a.email ?? "?"} />
              </Avatar.Root>
              <VStack align="start" gap={0.5} flex={1} minWidth={0}>
                <HStack gap={1.5} width="full">
                  <Text textStyle="2xs" fontWeight="600">
                    {a.user?.name ?? a.email ?? "anonymous"}
                  </Text>
                  {a.expectedOutput && (
                    <Icon as={Lightbulb} boxSize={2.5} color="yellow.fg" />
                  )}
                  <Box flex={1} />
                  <Text textStyle="2xs" color="fg.subtle">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </Text>
                </HStack>
                {a.comment && (
                  <Text textStyle="2xs" color="fg.muted" lineClamp={3}>
                    {a.comment}
                  </Text>
                )}
              </VStack>
            </HStack>
          ))}
        </VStack>
        <Box height="1px" bg="border.muted" marginX={-3} />
        <Text textStyle="2xs" color="fg.subtle">
          Open Conversation → Annotations to edit.
        </Text>
      </VStack>
    ),
  };
}

function buildChipDef(
  data: TraceHeaderChipData,
  index: number,
  callbacks: {
    onSelectSpan: (spanId: string) => void;
    onOpenPromptsTab: () => void;
  },
): ChipDef | null {
  const priority = index;
  switch (data.kind) {
    case "service":
      return { ...buildServiceChipDef(data), priority };
    case "origin":
      return { ...buildOriginChipDef(data), priority };
    case "scenario":
      return { ...buildScenarioChipDef(data.data), priority };
    case "sdk":
      return { ...buildSdkChipDef(data.sdk), priority };
    case "promptSelected":
      return {
        ...buildSelectedPromptChipDef(
          data.selectedId,
          data.spanId,
          callbacks.onSelectSpan,
        ),
        priority,
      };
    case "promptLastUsed":
      return {
        ...buildLastUsedPromptChipDef({
          handle: data.handle,
          versionNumber: data.versionNumber,
          spanId: data.spanId,
          state: data.state,
          driftFromSelection: data.driftFromSelection,
          outOfDate: data.outOfDate,
          onSelectSpan: callbacks.onSelectSpan,
          onOpenPromptsTab: callbacks.onOpenPromptsTab,
        }),
        priority,
      };
  }
}

/**
 * Combined service+origin chip. Primary value is the service name (the more
 * specific signal); origin is appended as a small caption. The popover
 * shows both with their own filter buttons so the trace table can be
 * scoped to either independently.
 */
function buildServiceChipDef(
  data: Extract<TraceHeaderChipData, { kind: "service" }>,
): ChipDef {
  return {
    id: "service",
    label: "Service",
    value: data.service,
    icon: LuServer,
    tone: "neutral",
    ariaLabel: `Service: ${data.service}`,
    onFilter: data.onFilter,
    filterLabel: "Filter table by service",
  };
}

function buildOriginChipDef(
  data: Extract<TraceHeaderChipData, { kind: "origin" }>,
): ChipDef {
  return {
    id: "origin",
    label: "Origin",
    value: data.origin,
    icon: LuGlobe,
    tone: "neutral",
    ariaLabel: `Origin: ${data.origin}`,
    onFilter: data.onFilter,
    filterLabel: "Filter table by origin",
  };
}

function buildSdkChipDef(sdk: SdkInfoLike): ChipDef {
  return {
    id: "sdk",
    label: "SDK",
    value: sdk.shortLabel,
    icon: LuCode,
    tone: "neutral",
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="220px" maxWidth="300px">
        <Text textStyle="xs" fontWeight="semibold">
          {sdk.longLabel}
        </Text>
        <Text textStyle="2xs" color="fg.muted" lineHeight="1.4">
          {sdk.description}
        </Text>
        <VStack align="stretch" gap={0.5} paddingTop={1}>
          <SdkRow label="Library" value={sdk.rawName} />
          {sdk.version && <SdkRow label="Version" value={sdk.version} />}
          <SdkRow label="Language" value={sdk.language} />
          {sdk.family && <SdkRow label="Family" value={sdk.family} />}
          {sdk.scenario && (
            <SdkRow
              label="Scenario"
              value={
                sdk.scenario.version ? `SDK ${sdk.scenario.version}` : "active"
              }
            />
          )}
        </VStack>
      </VStack>
    ),
  };
}

function buildSelectedPromptChipDef(
  selectedId: string,
  spanId: string | null,
  onSelectSpan: (spanId: string) => void,
): ChipDef {
  return {
    id: `prompt-selected:${selectedId}`,
    label: "Selected",
    value: selectedId,
    icon: LuBookMarked,
    tone: "blue",
    onClick: spanId ? () => onSelectSpan(spanId) : undefined,
    tooltip: (
      <VStack align="stretch" gap={1} minWidth="220px" maxWidth="300px">
        <Text textStyle="sm" fontWeight="semibold" fontFamily="mono">
          {selectedId}
        </Text>
        <Text textStyle="2xs" color="fg.muted">
          Pin set on the span. Resolved to a different concrete prompt at
          runtime — see the &ldquo;last used&rdquo; chip for what actually ran.
        </Text>
      </VStack>
    ),
    ariaLabel: `Selected prompt ${selectedId}`,
  };
}

function buildLastUsedPromptChipDef({
  handle,
  versionNumber,
  spanId,
  state,
  driftFromSelection,
  outOfDate,
  onSelectSpan,
  onOpenPromptsTab,
}: {
  handle: string;
  versionNumber: number | null;
  spanId: string | null;
  state: PromptChipState;
  driftFromSelection: boolean;
  outOfDate: boolean;
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
}): ChipDef {
  const value = versionNumber != null ? `${handle} v${versionNumber}` : handle;
  const tone: "blue" | "yellow" | "neutral" = state.missing
    ? "neutral"
    : driftFromSelection || outOfDate
      ? "yellow"
      : "blue";
  const icon = state.missing
    ? LuCircleDashed
    : driftFromSelection || outOfDate
      ? LuTriangleAlert
      : LuHistory;

  const onClick = () => {
    if (spanId) {
      onSelectSpan(spanId);
    } else {
      onOpenPromptsTab();
    }
  };

  return {
    id: `prompt-last-used:${handle}:${versionNumber ?? ""}`,
    label: driftFromSelection ? "Last used" : "Prompt",
    value,
    icon,
    dot: state.missing ? undefined : "purple.solid",
    tone,
    onClick,
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="240px" maxWidth="320px">
        <HStack gap={2}>
          <Text textStyle="sm" fontWeight="semibold" fontFamily="mono">
            {handle}
          </Text>
          {versionNumber != null && (
            <Text textStyle="xs" color="fg.muted" fontFamily="mono">
              v{versionNumber}
            </Text>
          )}
        </HStack>
        {state.missing ? (
          <Text textStyle="2xs" color="fg.muted">
            Prompt no longer exists in this project. The trace still shows what
            ran at the time.
          </Text>
        ) : (
          <HStack gap={1}>
            <Icon as={LuSparkles} boxSize={3} color="purple.fg" />
            <Text textStyle="2xs" color="purple.fg" fontWeight="medium">
              Latest run on this trace
            </Text>
          </HStack>
        )}
        {outOfDate && state.latestVersion != null && (
          <HStack
            gap={1.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Icon as={LuTriangleAlert} boxSize={3} color="yellow.fg" />
            <Text textStyle="2xs" color="yellow.fg">
              Out of date — current latest is v{state.latestVersion}.
            </Text>
          </HStack>
        )}
        {driftFromSelection && (
          <HStack
            gap={1.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Icon as={LuTriangleAlert} boxSize={3} color="yellow.fg" />
            <Text textStyle="2xs" color="yellow.fg">
              Pinned prompt resolved to a different concrete prompt at runtime.
            </Text>
          </HStack>
        )}
        <Text
          textStyle="2xs"
          color="fg.subtle"
          paddingTop={1}
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          {spanId
            ? "Click to jump to the span that ran this prompt"
            : "Click to open the Prompts tab"}
        </Text>
      </VStack>
    ),
    ariaLabel: spanId
      ? `Jump to the span that ran prompt ${handle}`
      : `Open prompt ${handle} in the Prompts tab`,
  };
}

function SdkRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        textAlign="right"
        wordBreak="break-all"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
        overflow="hidden"
      >
        {value}
      </Text>
    </HStack>
  );
}
