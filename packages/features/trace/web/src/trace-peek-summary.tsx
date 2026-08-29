import { Box, Circle, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { formatCost, formatDuration, formatTokens } from "@langwatch/design-system/display-formatters";
import { STATUS_COLORS } from "./display-formatters";
import { useTraceHeader } from "./use-trace-header";

export type TracePeekSummaryProps = {
  projectId: string;
  traceId: string;
  /**
   * Approximate trace timestamp (ms epoch) forwarded to the summary fetch as a
   * partition-pruning hint. `trace_summaries` is partitioned on `OccurredAt`,
   * so a read filtered only by `traceId` cannot prune partitions and walks
   * every weekly partition including the cold S3 tier. Pass it from the
   * surrounding row whenever it is known; when omitted the popover falls back
   * to the unconstrained by-id fetch.
   */
  occurredAtMs?: number;
};

/**
 * The compact trace summary a hover-peek shows.
 *
 * The read is `tracesV2.header` on the same cache entry the drawer's own header
 * query uses, which is the point: opening the drawer on a trace the reader has
 * already hovered is a cache hit, and `useOpenTraceDrawer`'s `setData` seed
 * (still an application hook) lands on this query too.
 *
 * `full: false` — the popover only ever shows a 2-line clamp of input/output,
 * never worth what full resolution of offloaded content costs.
 */
export function TracePeekSummary({ projectId, traceId, occurredAtMs }: TracePeekSummaryProps) {
  const { header: trace, isLoading } = useTraceHeader({
    projectId,
    traceId,
    occurredAtMs,
    full: false,
  });

  if (isLoading || !trace) {
    return (
      <VStack align="stretch" gap={2} padding={3}>
        <Skeleton height="16px" width="60%" borderRadius="sm" />
        <Skeleton height="12px" width="80%" borderRadius="sm" />
        <Skeleton height="12px" width="40%" borderRadius="sm" />
      </VStack>
    );
  }

  const statusColor = STATUS_COLORS[trace.status] as string;

  return (
    <VStack align="stretch" gap={0}>
      <HStack padding={3} gap={2}>
        <Circle size="8px" bg={statusColor} flexShrink={0} />
        <Text textStyle="sm" fontWeight="semibold" truncate flex={1}>
          {trace.traceName || trace.name}
        </Text>
      </HStack>

      <HStack paddingX={3} paddingBottom={2} gap={3} flexWrap="wrap">
        <PeekMetric label="Duration" value={formatDuration(trace.durationMs)} />
        {(trace.totalCost ?? 0) > 0 && (
          <PeekMetric label="Cost" value={formatCost(trace.totalCost ?? 0)} />
        )}
        {trace.totalTokens > 0 && (
          <PeekMetric label="Tokens" value={formatTokens(trace.totalTokens)} />
        )}
        {trace.models.length > 0 && <PeekMetric label="Model" value={trace.models[0]!} />}
        <PeekMetric label="Spans" value={String(trace.spanCount)} />
      </HStack>

      <Box height="1px" bg="border.muted" />

      {(trace.input || trace.output) && (
        <VStack align="stretch" gap={1} padding={3}>
          {trace.input && <PeekContent label="Input" value={trace.input} />}
          {trace.output && <PeekContent label="Output" value={trace.output} />}
        </VStack>
      )}

      {trace.error && (
        <Box paddingX={3} paddingBottom={2}>
          <Box padding={2} borderRadius="sm" bg="red.subtle">
            <Text textStyle="xs" color="red.fg" lineClamp={2}>
              {trace.error}
            </Text>
          </Box>
        </Box>
      )}
    </VStack>
  );
}

function PeekMetric({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={1}>
      <Text textStyle="2xs" color="fg.subtle">
        {label}:
      </Text>
      <Text textStyle="2xs" color="fg" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}

function PeekContent({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text textStyle="2xs" fontWeight="medium" color="fg.muted" marginBottom={0.5}>
        {label}
      </Text>
      <Text textStyle="xs" color="fg" lineClamp={2} whiteSpace="pre-wrap" wordBreak="break-word">
        {value}
      </Text>
    </Box>
  );
}
