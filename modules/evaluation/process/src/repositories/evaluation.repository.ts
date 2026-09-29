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

import type { EvaluationRetentionLookup } from "../app/evaluation.members.ts";

/** A run lookup with the tenant retention its unbounded fallback is floored at. */
export type EvaluationRunFloorLookup = EvaluationRunLookup &
  Readonly<{ retention: EvaluationRetentionLookup }>;

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
  abstract getByEvaluationId(input: EvaluationRunFloorLookup): Promise<EvaluationRunData>;
  abstract findByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]>;
  abstract findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  abstract findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  abstract findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null>;
}
