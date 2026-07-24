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
  isSpansLoading?: boolean;
  onSelectSpan?: (spanId: string) => void;
}

export const TraceAccordions = memo(function TraceAccordions({
  trace,
  spans,
  selectedSpan,
  activeTab,
  selectedSpanId,
  isSpansLoading,
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
  // Span tab + an id we haven't resolved yet + tree is still loading →
  // render a skeleton instead of falling through to the trace summary.
  // Without this branch, clicking "Open span" on a trace whose spans
  // were mid-fetch landed the operator on the trace summary view, which
  // read like the jump hadn't taken effect. Once the tree resolves but
  // the spanId isn't in it (deleted span, stale link), we DO fall
  // through to the summary — the operator gets a graceful "couldn't
  // find that span" landing rather than an indefinite skeleton.
  if (activeTab === "span" && selectedSpanId && isSpansLoading) {
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
  return (
    <TraceSummaryAccordions
      trace={trace}
      spans={spans}
      onSelectSpan={onSelectSpan}
    />
  );
});
