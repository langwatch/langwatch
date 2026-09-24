import type {
  EvaluationInputsQuery,
  EvaluationRunData,
  EvaluationRunLookup,
  EvaluationRunsByTraceQuery,
  EvaluationSummariesByTraceIdsQuery,
  EvaluationSummary,
  TraceEvaluationData,
  TraceEvaluationsQuery,
} from "@langwatch/evaluation-contract";

/** Private persistence port for the Evaluation server package. */
export abstract class EvaluationRunRepository {
  abstract upsert(input: {
    data: EvaluationRunData;
    tenantId: string;
    retentionDays?: number;
  }): Promise<void>;
  abstract upsertBatch(
    input: { data: EvaluationRunData; tenantId: string; retentionDays?: number }[],
  ): Promise<void>;
  /** Throws `EvaluationNotFoundError` when the tenant holds no such run. */
  abstract getByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData>;
  abstract findByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]>;
  abstract findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  abstract findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  abstract findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null>;
}
