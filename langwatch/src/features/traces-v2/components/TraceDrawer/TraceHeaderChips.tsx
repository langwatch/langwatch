import { HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  LuBoxes,
  LuCircleDashed,
  LuCode,
  LuFileText,
  LuServer,
  LuSparkles,
  LuTriangleAlert,
} from "react-icons/lu";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
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
  const { chips } = useTraceHeaderChips(trace, {
    onSelectSpan,
    onOpenPromptsTab,
  });

  const chipDefs: ChipDef[] = chips
    .map((c, idx): ChipDef | null =>
      buildChipDef(c, idx, { onSelectSpan, onOpenPromptsTab }),
    )
    .filter((c): c is ChipDef => c != null);

  return <ChipBar chips={chipDefs} endSlot={endSlot} />;
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
      return {
        id: "service",
        label: "Service",
        value: data.value,
        icon: LuServer,
        tone: "neutral",
        priority,
        onFilter: data.onFilter,
        filterLabel: `Filter the trace table by service ${data.value}`,
      };
    case "origin":
      return {
        id: "origin",
        label: "Origin",
        value: data.value,
        icon: LuBoxes,
        tone: "neutral",
        priority,
        onFilter: data.onFilter,
        filterLabel: `Filter the trace table by origin ${data.value}`,
      };
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
    icon: LuFileText,
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
      : LuFileText;

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
