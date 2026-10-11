import type { Authorization } from "@langwatch/authorization";
import type {
  FillIdIndexesOptions,
  IdIndexFillReport,
  IdIndexFlags,
  RetentionDaysProvider,
} from "@langwatch/clickhouse-client";
import type { EvaluationRunData, EvaluationRunLookup } from "@langwatch/evaluation-contract";

/** A run lookup fenced by a proof instead of a bare tenant id (ruling AGG-EVAL-PROOF). */
export type EvaluationRunProofLookup = Omit<EvaluationRunLookup, "tenantId"> &
  Readonly<{ authorization: Authorization }>;

/** A fenced run lookup with the tenant retention its unbounded fallback is floored at. */
export type EvaluationRunFloorLookup = EvaluationRunProofLookup &
  Readonly<{
    retention: EvaluationRetentionLookup;
    /** Whether the run id index may bound a lookup with no time; absent reads as off. */
    idIndex?: IdIndexFlags | undefined;
  }>;

/** What a fill of Evaluation's id indexes takes; the repository supplies its own statements. */
export type EvaluationIdIndexFill = Omit<
  FillIdIndexesOptions,
  "statements" | "targets" | "indexes" | "beforeFlag"
> & {
  /** Runs once a target is filled, before its flags, with the index tables retention copies to. */
  beforeFlag: (input: {
    target: Parameters<FillIdIndexesOptions["beforeFlag"]>[0]["target"];
    indexes: readonly string[];
  }) => Promise<void>;
};

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
    idIndex?: IdIndexFlags | undefined;
  }): Promise<EvaluationInputsRead | null>;
  /** Fills the run id index from rows older than its view, on every ClickHouse target. */
  abstract fillIdIndexes(input: EvaluationIdIndexFill): Promise<IdIndexFillReport>;
}

/** One run's inputs and the project its row was read from (the member, on an aggregate). */
export type EvaluationInputsRead = { tenantId: string; inputs: Record<string, unknown> | null };

/** Each tenant's retention, which the ClickHouse run read floors its partition scan at. */
export interface EvaluationRetentionLookup extends RetentionDaysProvider {
  /** What the floor falls back to when the tenant's retention cannot be read. */
  getPlatformDefaultRetentionDays(): number;
}
