import type { Authorization } from "@langwatch/authorization";
import type { RetentionDaysProvider } from "@langwatch/clickhouse-client";
import type { EvaluationRunData, EvaluationRunLookup } from "@langwatch/evaluation-contract";

/** A run lookup fenced by a proof instead of a bare tenant id (ruling AGG-EVAL-PROOF). */
export type EvaluationRunProofLookup = Omit<EvaluationRunLookup, "tenantId"> &
  Readonly<{ authorization: Authorization }>;

/** A fenced run lookup with the tenant retention its unbounded fallback is floored at. */
export type EvaluationRunFloorLookup = EvaluationRunProofLookup &
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
  /** Throws `EvaluationNotFoundError` when no project the proof reads holds the run. */
  abstract getByEvaluationId(input: EvaluationRunFloorLookup): Promise<EvaluationRunData>;
  abstract findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]>;
  /** The newest inputs in the first project the proof reads that holds the run. */
  abstract findInputs(input: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<EvaluationInputsRead | null>;
}

/** One run's inputs and the project its row was read from (the member, on an aggregate). */
export type EvaluationInputsRead = { tenantId: string; inputs: Record<string, unknown> | null };

/** Each tenant's retention, which the ClickHouse run read floors its partition scan at. */
export interface EvaluationRetentionLookup extends RetentionDaysProvider {
  /** What the floor falls back to when the tenant's retention cannot be read. */
  getPlatformDefaultRetentionDays(): number;
}
