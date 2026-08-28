import { Circle, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  LuBookMarked,
  LuCircleAlert,
  LuCircleDashed,
  LuCircleSlash,
  LuCode,
  LuGlobe,
  LuMessageSquare,
  LuServer,
  LuSparkles,
  LuTriangleAlert,
} from "react-icons/lu";
import type { TraceHeader } from "@langwatch/trace-contract";
import type { EvalChipDisplay } from "~/utils/evaluationResults";
import { getEvalChipDisplay } from "~/utils/evaluationResults";
import { useConversationAnnotations } from "../../hooks/useConversationAnnotations";
import { useConversationTurns } from "../../hooks/useConversationTurns";
import { useSpanTree } from "../../hooks/useSpanTree";
import type { RichEval } from "../../hooks/useTraceEvaluations";
import {
  type PromptChipState,
  type SdkInfoLike,
  type TraceHeaderChipData,
  useTraceHeaderChips,
} from "../../hooks/useTraceHeaderChips";
import { useDrawerStore } from "@langwatch/trace-web";
import { TraceCommentList } from "./anchoredComments/TraceCommentList";
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
  // Trace header has plenty of horizontal room and eval/prompt chips are
  // load-bearing signal — let up to 10 chips ride the strip before
  // collapsing into the "+N more" pill, otherwise the second & third
  // eval verdicts (the most actionable ones in a multi-evaluator setup)
  // get hidden by default.
  return <ChipBar chips={chipDefs} maxVisible={10} endSlot={endSlot} />;
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
 * same conversation. Hidden when there are zero. Click to peek at the list and
 * land in the Conversation view, where each annotation reads beside the turn
 * it is about and can be edited there.
 */
function useAnnotationsChip(trace: TraceHeader): ChipDef | null {
  const conversation = useConversationTurns(trace.conversationId ?? null);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const traceIds = useMemo(
    () => [
      trace.traceId,
      ...(conversation.data?.items ?? [])
        .map((t) => t.traceId)
        .filter((id) => id !== trace.traceId),
    ],
    [trace.traceId, conversation.data?.items],
  );

  const annotations = useConversationAnnotations(traceIds);
  // The trace as the reader sees it, corrections applied: a span a correction
  // removed is not a part of it any more, which is what makes a comment left on
  // that span read as being about a part that is no longer there.
  const spans = useSpanTree().data;
  const spanNames = useMemo(
    () => new Map((spans ?? []).map((span) => [span.spanId, span.name])),
    [spans],
  );
  const resolvable = useMemo(
    () => new Set<string>([trace.traceId, ...(spans ?? []).map((span) => span.spanId)]),
    [trace.traceId, spans],
  );

  const items = annotations.all;
  if (items.length === 0) return null;

  return {
    id: "annotations",
    label: "Annotations",
    value: String(items.length),
    icon: LuMessageSquare,
    tone: "yellow",
    priority: 1,
    // A threadless trace has no conversation to switch to; the popover list
    // is all there is.
    onClick: trace.conversationId ? () => setViewMode("conversation") : undefined,
    popover: (
      <TraceCommentList
        traceId={trace.traceId}
        comments={items}
        spanNames={spanNames}
        resolvable={resolvable}
      />
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
    case "eval":
      return { ...buildEvalChipDef(data.eval, data.onClick), priority };
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
              value={sdk.scenario.version ? `SDK ${sdk.scenario.version}` : "active"}
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
        <Text textStyle="sm" fontWeight="semibold">
          {selectedId}
        </Text>
        <Text textStyle="2xs" color="fg.muted">
          Pin set on the span. Resolved to a different concrete prompt at runtime — see
          the &ldquo;last used&rdquo; chip for what actually ran.
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
  // Drop the leading history glyph on the happy path — the purple status
  // dot + the "Prompt" label already say what this chip is, and the icon
  // was just visual noise next to the verbose handle. We do keep the
  // warning glyph for drift / out-of-date so the chip's tone change isn't
  // the only signal that something's off.
  const icon = state.missing
    ? LuCircleDashed
    : driftFromSelection || outOfDate
      ? LuTriangleAlert
      : undefined;

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
          <Text textStyle="sm" fontWeight="semibold">
            {handle}
          </Text>
          {versionNumber != null && (
            <Text textStyle="xs" color="fg.muted">
              v{versionNumber}
            </Text>
          )}
        </HStack>
        {state.missing ? (
          <Text textStyle="2xs" color="fg.muted">
            Prompt no longer exists in this project. The trace still shows what ran at the
            time.
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

/**
 * The chip's trailing verdict: a tinted badge for skipped/error, the category
 * for a categorising evaluator, the numeral for a scoring one, colored
 * Pass/Fail for a judging one. Mirrors the trace-table EvalChip.
 */
function EvalChipVerdict({ display }: { display: EvalChipDisplay }) {
  if (display.status === "skipped")
    return <NoVerdictMicroBadge icon={LuCircleSlash} label="SKIPPED" />;
  if (display.status === "error")
    return <NoVerdictMicroBadge icon={LuCircleAlert} label="ERROR" />;
  if (display.categoryLabel)
    return (
      <Text textStyle="2xs" fontWeight="semibold" color="blue.fg" truncate>
        {display.categoryLabel}
      </Text>
    );
  if (display.scoreText)
    return (
      <Text textStyle="2xs" fontWeight="semibold" color="fg.muted">
        {display.scoreText}
      </Text>
    );
  if (display.passLabel)
    return (
      <Text textStyle="2xs" fontWeight="semibold" color={display.passLabel.color}>
        {display.passLabel.text}
      </Text>
    );
  return null;
}

function buildEvalChipDef(ev: RichEval, onClick: () => void): ChipDef {
  // Single source of truth for color / status label / score formatting.
  // The trace-list `EvalChip`, the v3 EvaluatorChip, and this header
  // chip all derive their display from `getEvalChipDisplay` so the
  // visuals never drift between surfaces.
  const display = getEvalChipDisplay({
    name: ev.name,
    evaluatorId: ev.evaluatorId,
    status: ev.status,
    score: ev.score,
    scoreType: ev.scoreType,
    label: ev.label,
    passed: ev.passed,
  });
  // Header eval chips always render on a neutral bg — colored backgrounds
  // would turn the strip into a rainbow when several evaluators land on a
  // trace. The status colour shows up in the leading dot + the
  // pass/fail label text, matching the trace-table EvalChip and the v3
  // EvaluatorChip exactly.
  const tone = "neutral" as const;
  const valueNode = (
    <HStack gap={1} flexShrink={0} align="center">
      <Text textStyle="xs" color="fg" fontWeight="medium" truncate>
        {display.displayName}
      </Text>
      <EvalChipVerdict display={display} />
    </HStack>
  );
  return {
    id: `eval:${ev.evaluationId}`,
    label: "Eval",
    value: valueNode,
    // No leading icon — the colored status dot is the eval's identity
    // and reads from the shared `EVALUATION_STATUS_COLORS` map so it
    // matches the v3 EvaluatorChip and the trace-list EvalChip exactly
    // (skipped = yellow, error = red, etc.).
    dot: display.color,
    tone,
    onClick,
    ariaLabel: `Eval ${display.displayName}: ${display.categoryLabel ?? display.statusLabel}${display.scoreText ? ` ${display.scoreText}` : ""}`,
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="240px" maxWidth="340px">
        <HStack gap={2}>
          <Circle size="10px" bg={display.color} flexShrink={0} />
          <Text textStyle="sm" fontWeight="semibold" truncate>
            {display.displayName}
          </Text>
        </HStack>
        <HStack justify="space-between" gap={3}>
          <Text textStyle="2xs" color="fg.muted">
            Status
          </Text>
          <Text textStyle="2xs" fontWeight="semibold" color={display.color}>
            {display.statusLabel}
          </Text>
        </HStack>
        {display.scoreText && (
          <HStack justify="space-between" gap={3}>
            <Text textStyle="2xs" color="fg.muted">
              Score
            </Text>
            <Text textStyle="2xs" fontWeight="semibold">
              {display.scoreText}
            </Text>
          </HStack>
        )}
        {ev.label && (
          <HStack justify="space-between" gap={3}>
            <Text textStyle="2xs" color="fg.muted">
              Label
            </Text>
            <Text textStyle="2xs" fontWeight="semibold">
              {ev.label}
            </Text>
          </HStack>
        )}
        {ev.reasoning && (
          <VStack
            align="stretch"
            gap={0.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Text textStyle="2xs" color="fg.muted">
              Reasoning
            </Text>
            <Text textStyle="2xs" color="fg" whiteSpace="pre-wrap">
              {ev.reasoning}
            </Text>
          </VStack>
        )}
        {ev.errorMessage && (
          <VStack
            align="stretch"
            gap={0.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Text textStyle="2xs" color="red.fg">
              Error
            </Text>
            <Text textStyle="2xs" color="fg" whiteSpace="pre-wrap">
              {ev.errorMessage}
            </Text>
          </VStack>
        )}
        <Text
          textStyle="2xs"
          color="fg.subtle"
          paddingTop={1}
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          Click to jump to the Evals section
        </Text>
      </VStack>
    ),
  };
}

/**
 * Tiny inline "no verdict" badge for the eval chip's value slot. Matches
 * the visual language of the EvalCard's status tag (tinted bg, leading
 * icon, uppercase letter-spaced label) so the same status reads the same
 * way at every scale: chip → list pill → card header.
 */
function NoVerdictMicroBadge({
  icon,
  label,
}: {
  icon: typeof LuCircleSlash;
  label: string;
}) {
  return (
    <HStack
      gap={0.5}
      paddingX={1}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.muted"
      flexShrink={0}
      lineHeight="1"
    >
      <Icon as={icon} boxSize={2.5} color="fg.muted" />
      <Text textStyle="2xs" fontWeight="bold" color="fg.muted" letterSpacing="0.04em">
        {label}
      </Text>
    </HStack>
  );
}

function SdkRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
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
