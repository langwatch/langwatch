import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";

/**
 * Persistence for the coding-agent session rollup (ADR-041, migration 00042).
 *
 * One row per session. Idempotent by construction: the table is a
 * ReplacingMergeTree(UpdatedAt) and every read dedups to the latest UpdatedAt
 * per (TenantId, TraceId), so a re-fold simply writes a newer version.
 */
export interface CodingAgentSessionRepository {
  upsert(row: CodingAgentSessionRow, retentionDays?: number): Promise<void>;

  /** Batch path. The store falls back to per-row upsert when absent. */
  upsertBatch?(
    rows: Array<{ row: CodingAgentSessionRow; retentionDays?: number }>,
  ): Promise<void>;

  /**
   * The session for one trace, or null. A point read inside one partition —
   * `startedAtMs` is the partition-pruning hint and should be passed whenever
   * the caller has it.
   */
  getByTraceId(params: {
    tenantId: string;
    traceId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSessionRow | null>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentSessionRepository
  implements CodingAgentSessionRepository
{
  async upsert(): Promise<void> {
    // no-op
  }

  async getByTraceId(): Promise<CodingAgentSessionRow | null> {
    return null;
  }
}
