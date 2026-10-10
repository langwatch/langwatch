import type { Authorization } from "@langwatch/authorization";
import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";
import type {
  EvaluationTraceEvent,
  EvaluationTraceSpan,
  SpanTreeCursor,
  SpanTreeNode,
} from "@langwatch/trace-contract";

/** A private read record; cost inputs never leave the Trace service. */
export type TraceSpanSummaryRecord = SpanTreeNode & {
  cost: number | null;
  costInput: ModelCostEstimateInput;
};

export type TraceSpanPage = {
  rows: TraceSpanSummaryRecord[];
  hasMore: boolean;
};

export type TraceIngestLagSample = {
  p95LagMs: number;
  sampleCount: number;
};

/** The single projected Trace persistence boundary. */
export abstract class TraceProjectedReadRepository {
  abstract findEvaluationSpans(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceSpan[]>;

  abstract findEvaluationEvents(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<EvaluationTraceEvent[]>;

  abstract findIngestLag(input: {
    authorization: Authorization;
  }): Promise<TraceIngestLagSample | null>;

  abstract listSummaryPage(input: {
    authorization: Authorization;
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
    authorization: Authorization;
    traceId: string;
    sinceUpdatedAtMs: number;
  }): Promise<TraceSpanSummaryRecord[]>;
}
