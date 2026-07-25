import { Box, Button, HStack, Icon, Skeleton, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../utils/formatters";

const LLM_REQUEST_SPAN = "claude_code.llm_request";
const TOOL_SPAN = "claude_code.tool";

const CELL = { fontFamily: "mono", fontSize: "11px" } as const;

interface TurnStepsProps {
  traceId: string;
  /** Partition-pruning hint for the span read. */
  occurredAtMs?: number;
  /** Off the turn's summary, so the count costs no query. */
  spanCount: number;
}

/**
 * What actually ran inside one coding-agent turn.
 *
 * A Claude Code turn is an agentic LOOP — model, tool, model, tool, answer —
 * and the conversation's user/assistant bubbles show only its two ends. A turn
 * that ran twelve tools and called the model five times looks, in the thread,
 * exactly like a turn that answered in one shot. This strip is the middle.
 *
 * Collapsed it costs nothing: the step count rides on the turn summary already.
 * The spans are fetched only when the row is actually opened, so a long thread
 * doesn't fire a query per turn.
 */
export const TurnSteps = memo(function TurnSteps({
  traceId,
  occurredAtMs,
  spanCount,
}: TurnStepsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const query = api.tracesV2.spansFull.useQuery(
    { projectId, traceId, occurredAtMs },
    {
      enabled: isOpen && projectId !== "",
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  );

  const steps = useMemo(() => selectSteps(query.data ?? []), [query.data]);

  if (spanCount === 0) return null;

  return (
    <VStack align="stretch" gap={1} paddingLeft={7}>
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        color="fg.muted"
        gap={1}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <Icon as={isOpen ? ChevronDown : ChevronRight} boxSize="12px" />
        {isOpen ? "Hide steps" : `${spanCount} steps ran`}
      </Button>

      {isOpen && (
        <Box
          borderLeftWidth="1px"
          borderColor="border.muted"
          paddingLeft={3}
          paddingY={1}
        >
          {query.isLoading ? (
            <VStack align="stretch" gap={1.5} aria-busy="true">
              {["55%", "70%", "40%"].map((w) => (
                <Skeleton key={w} height="10px" width={w} borderRadius="sm" />
              ))}
            </VStack>
          ) : query.isError ? (
            <Text textStyle="2xs" color="fg.error">
              Couldn&apos;t load this turn&apos;s steps
            </Text>
          ) : steps.length === 0 ? (
            <Text textStyle="2xs" color="fg.subtle">
              No model or tool steps recorded
            </Text>
          ) : (
            <VStack align="stretch" gap={0.5}>
              {steps.map((step) => (
                <StepRow key={step.spanId} step={step} />
              ))}
            </VStack>
          )}
        </Box>
      )}
    </VStack>
  );
});

interface Step {
  spanId: string;
  kind: "model" | "tool";
  label: string;
  arg: string | null;
  durationMs: number;
  isError: boolean;
  tokens: number;
  costUsd: number;
}

/** The turn's model calls and tool runs, in the order they happened. */
function selectSteps(spans: SpanDetail[]): Step[] {
  return spans
    .filter(
      (span) => span.name === LLM_REQUEST_SPAN || span.name === TOOL_SPAN,
    )
    .slice()
    .sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map((span) => {
      const params = (span.params ?? {}) as Record<string, unknown>;
      const isTool = span.name === TOOL_SPAN;
      return {
        spanId: span.spanId,
        kind: isTool ? ("tool" as const) : ("model" as const),
        label: isTool
          ? asString(params.tool_name) ?? "Tool"
          : abbreviateModel(span.model ?? "model"),
        arg: isTool
          ? asString(params.full_command) ?? asString(params.file_path)
          : null,
        durationMs: span.durationMs,
        isError: span.status === "error",
        tokens:
          (span.metrics?.promptTokens ?? 0) +
          (span.metrics?.completionTokens ?? 0),
        costUsd: span.metrics?.cost ?? 0,
      };
    });
}

function StepRow({ step }: { step: Step }) {
  const isTool = step.kind === "tool";
  return (
    <HStack gap={2} align="baseline">
      <Text
        {...CELL}
        color={step.isError ? "red.fg" : isTool ? "green.fg" : "blue.fg"}
        flexShrink={0}
        userSelect="none"
        aria-hidden
      >
        {isTool ? "⏺" : "◆"}
      </Text>
      <Text {...CELL} color="fg" flexShrink={0}>
        {step.label}
      </Text>
      {step.arg && (
        <Text {...CELL} color="fg.subtle" truncate minWidth={0} flex={1}>
          {step.arg}
        </Text>
      )}
      <Box flex={step.arg ? undefined : 1} />
      {step.tokens > 0 && (
        <Text {...CELL} color="fg.subtle" flexShrink={0}>
          {`${formatTokens(step.tokens)} tok`}
        </Text>
      )}
      {step.costUsd > 0 && (
        <Text {...CELL} color="fg.subtle" flexShrink={0}>
          {formatCost(step.costUsd)}
        </Text>
      )}
      {step.durationMs > 0 && (
        <Text {...CELL} color="fg.subtle" flexShrink={0}>
          {formatDuration(step.durationMs)}
        </Text>
      )}
    </HStack>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
