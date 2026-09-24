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

import type { EvaluationRetentionFloor } from "../app/evaluation.members.ts";

/** A run lookup with the floor its unbounded fallback will not read below. */
export type EvaluationRunFloorLookup = EvaluationRunLookup &
  Readonly<{ retentionFloor: EvaluationRetentionFloor }>;

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
