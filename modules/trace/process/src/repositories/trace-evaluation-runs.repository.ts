import type { Authorization } from "@langwatch/authorization";
import type {
  EvaluationRunData,
  EvaluationSummary,
  TraceEvaluationData,
} from "@langwatch/evaluation-contract";

/**
 * Evaluation's runs, read through the `evaluation_runs` table it shares with
 * trace for reading (R40, EF-5); trace writes none.
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
export abstract class TraceEvaluationRunsReadRepository {
  /** The latest version of each run recorded against one trace in the last seven days. */
  abstract findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]>;

  /** As `findRunsByTraceId`, read through the proof: a member is read only inside its grant (ADR-177). */
  abstract findReadableRunsByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]>;

  /**
   * The latest version of each run scheduled since `since`, read through the proof (ADR-177
   * block C). Each names the tenant it was read from: two members may hold the same trace id.
   */
  abstract findSummariesByTraceIds(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    since: number;
  }): Promise<(EvaluationSummary & { tenantId: string })[]>;

  /** The latest version of each run against the traces; every asked trace has an entry. */
  abstract findTraceEvaluations(input: {
    tenantId: string;
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>>;

  /** As `findTraceEvaluations`, read through the proof: a member only inside its grant (ADR-177). */
  abstract findReadableTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>>;
}
