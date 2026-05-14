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
  onSelectSpan?: (spanId: string) => void;
}

export const TraceAccordions = memo(function TraceAccordions({
  trace,
  spans,
  selectedSpan,
  activeTab,
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
  return (
    <TraceSummaryAccordions
      trace={trace}
      spans={spans}
      onSelectSpan={onSelectSpan}
    />
  );
});
