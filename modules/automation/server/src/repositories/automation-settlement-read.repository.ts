import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type {
  DerivedTraceEvent,
  TraceQueryClassification,
  TraceRecord,
  TraceSummaryData,
} from "@langwatch/trace-contract";

// Port for the four trace reads settlement needs; AutomationTraceRecordUnavailableError
// distinguishes composition failures from missing traces.

// What an implementer throws when it cannot answer `getById` AT ALL.
export class AutomationTraceRecordUnavailableError extends Error {
  readonly name = "AutomationTraceRecordUnavailableError";
}

export abstract class AutomationSettlementTraceReader {
  abstract findSummary(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null>;

  /**
   * The full record, or a stated reason there is none.
   *
   * Throws `TraceNotFoundError` when the trace is gone and
   * {@link AutomationTraceRecordUnavailableError} when the reader itself cannot
   * answer. Every other failure is a real one and propagates.
   */
  abstract getById(input: { projectId: string; traceId: string }): Promise<TraceRecord>;

  abstract classifyQuery(input: { query: string }): TraceQueryClassification;

  abstract deriveEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }): Promise<DerivedTraceEvent[]>;
}

/**
 * The one evaluation read a settled match's filters are checked against.
 *
 * `EvaluationService` is ten methods over execution, monitor performance and
 * workflow resolution; the confirmation check reaches exactly this one, and it
 * is a ClickHouse read keyed by trace.
 */
export abstract class AutomationSettlementEvaluationReader {
  abstract findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]>;
}
