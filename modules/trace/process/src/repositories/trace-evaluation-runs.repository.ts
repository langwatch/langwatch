import type { Authorization } from "@langwatch/authorization";
import type {
  EvaluationRunData,
  EvaluationSummary,
  TraceEvaluationData,
} from "@langwatch/evaluation-contract";

/**
 * Evaluation's runs, read through the `evaluation_runs` table it shares with
 * trace for reading (R40, EF-5); trace writes none. Every read is fenced by the
 * route's proof (ADR-175), windowed on `ScheduledAt`.
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
export abstract class TraceEvaluationRunsReadRepository {
  /** The latest version of each run recorded against one trace in the last seven days. */
  abstract findRunsByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]>;

  /** The latest version of each run scheduled since `since`, grouped by trace. */
  abstract findSummariesByTraceIds(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>>;

  /** The latest version of each run against the traces; every asked trace has an entry. */
  abstract findTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>>;
}
