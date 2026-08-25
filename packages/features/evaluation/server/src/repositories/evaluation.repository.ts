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
  abstract upsert(input: { data: EvaluationRunData; tenantId: string; retentionDays?: number }): Promise<void>;
  abstract upsertBatch(input: Array<{ data: EvaluationRunData; tenantId: string; retentionDays?: number }>): Promise<void>;
  abstract tryFindByEvaluationId(
    input: EvaluationRunLookup,
  ): Promise<EvaluationRunData | null>;
  abstract findByTraceId(
    input: EvaluationRunsByTraceQuery,
  ): Promise<EvaluationRunData[]>;
  abstract findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  abstract findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  abstract tryFindInputs(
    input: EvaluationInputsQuery,
  ): Promise<Record<string, unknown> | null>;
}
