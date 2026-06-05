import { Box, Skeleton, VStack } from "@chakra-ui/react";
import { memo } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { SpanAccordions } from "./SpanAccordions";
import { useSyncSectionPresence } from "./sectionPresence";
import { TraceSummaryAccordions } from "./TraceSummaryAccordions";

interface TraceAccordionsProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  activeTab: "summary" | "span";
  /**
   * Set on the span-detail mount when the user has asked for a span
   * (via the row's drawer, the error popover's "Open span", the URL,
   * etc.) but the span tree hasn't resolved yet. Drives the
   * `activeTab === "span"` fallback below: when set, we render a
   * lightweight skeleton instead of dropping back to the trace summary,
   * because falling back was reading as "the open-span jump didn't
   * work" the moment the spanTree query was even slightly slow.
   */
  selectedSpanId?: string | null;
  spansLoading?: boolean;
  onSelectSpan?: (spanId: string) => void;
}

export const TraceAccordions = memo(function TraceAccordions({
  trace,
  spans,
  selectedSpan,
  activeTab,
  selectedSpanId,
  spansLoading,
  onSelectSpan,
}: TraceAccordionsProps) {
  useSyncSectionPresence({ traceId: trace.traceId, tab: activeTab });

  if (activeTab === "span" && selectedSpan) {
    return (
      // Key on spanId so React fully unmounts the old span's accordion
      // state when the user switches spans — otherwise the previous
      // span's open/closed sections and stale detail flicker through
      // during the transition.
      <SpanAccordions
        key={selectedSpan.spanId}
        traceId={trace.traceId}
        span={selectedSpan}
        onSelectSpan={onSelectSpan}
      />
    );
  }
  // Span tab + an id we haven't resolved yet → render a skeleton.
  // Previously this branch fell through to TraceSummaryAccordions, so
  // clicking "Open span" on a trace whose spans were mid-fetch landed
  // the operator on the trace summary view, which read like the jump
  // hadn't taken effect. The skeleton keeps us anchored on the span
  // pane until the tree lands and SpanAccordions can mount for real.
  if (activeTab === "span" && selectedSpanId) {
    return (
      <Box padding={4}>
        <VStack align="stretch" gap={2}>
          <Skeleton height="20px" width="40%" borderRadius="sm" />
          <Skeleton height="14px" width="65%" borderRadius="sm" />
          <Skeleton height="14px" width="55%" borderRadius="sm" />
          <Skeleton height="120px" borderRadius="md" />
          <Skeleton height="36px" borderRadius="md" />
          <Skeleton height="36px" borderRadius="md" />
        </VStack>
      </Box>
    );
  }
  // Silence the unused warning when spansLoading is consulted only by
  // future call sites — keeps the prop in the API without TS noise.
  void spansLoading;
  return (
    <TraceSummaryAccordions
      trace={trace}
      spans={spans}
      onSelectSpan={onSelectSpan}
    />
  );
});
