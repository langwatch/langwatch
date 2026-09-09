import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type {
  DerivedTraceEvent,
  TraceQueryClassification,
  TraceRecord,
  TraceSummaryData,
} from "@langwatch/trace-contract";

/**
 * The four trace reads settlement makes, declared by the feature that makes
 * them.
 *
 * `TraceService` is twelve methods over span trees, full records, threads,
 * evaluation spans and an ingest-wait cache; settlement reaches four. Naming
 * the whole service meant a process that wanted to settle a match had to
 * compose the trace read path entire — and `architecture-lint`'s `cross-feature`
 * policy forbids this package from importing Trace's server anyway, so the port
 * is where the two features meet. The published `TraceService` satisfies it
 * structurally.
 *
 * `classifyQuery` is synchronous because the published service's is: it is a
 * parse of the customer's own filter query, not a read.
 */
/**
 * What an implementer throws when it cannot answer `getById` AT ALL.
 *
 * Distinct from `TraceNotFoundError`, which means the trace is gone: this one
 * means this process has no full-record read composed. Both end at the same
 * place — the digest continues on the fold state it already holds — but only
 * this one is a permanent property of the composition rather than of the trace,
 * so keeping them apart is what stops a genuine ClickHouse outage being
 * mistaken for a missing trace and silently degrading every digest in the
 * fleet.
 */
export class AutomationTraceRecordUnavailableError extends Error {
  readonly name = "AutomationTraceRecordUnavailableError";
}

export abstract class AutomationSettlementTraceReaderPort {
  abstract tryGetSummary(input: {
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
export abstract class AutomationSettlementEvaluationReaderPort {
  abstract findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]>;
}
