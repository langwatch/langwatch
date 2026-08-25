import type { SpanTreeCursor, SpanTreeNode } from "@langwatch/trace-contract";
import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";

/** A private read record; cost inputs never leave the Trace service. */
export type TraceSpanSummaryRecord = SpanTreeNode & {
  cost: number | null;
  costInput: ModelCostEstimateInput;
};

export type TraceSpanPage = {
  rows: TraceSpanSummaryRecord[];
  hasMore: boolean;
};

/** The single projected Trace persistence boundary. */
export abstract class TraceRepository {
  abstract findSummaryPage(input: {
    tenantId: string;
    traceId: string;
    limit: number;
    cursor?: SpanTreeCursor;
    occurredAtMs?: number;
  }): Promise<TraceSpanPage>;

  /**
   * Latest version of each span that was projected after the supplied row
   * version. This deliberately keys on UpdatedAt rather than start time so a
   * closing root span is observable by a live waterfall poll.
   */
  abstract findSummarySince(input: {
    tenantId: string;
    traceId: string;
    sinceUpdatedAtMs: number;
  }): Promise<TraceSpanSummaryRecord[]>;
}
