import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";

/**
 * Persistence for the coding-agent session row (ADR-056, migration 00051).
 *
 * One row per session. Idempotent by construction: the table is a
 * ReplacingMergeTree(UpdatedAt) and every read dedups to the latest UpdatedAt
 * per (TenantId, SessionId), so a re-fold simply writes a newer version.
 *
 * Reads land in a later slice (`getBySessionId`, `listByUser`); the write
 * surface is what the fold store needs.
 */
export interface CodingAgentSessionRepository {
  upsert(row: CodingAgentSessionRow, retentionDays?: number): Promise<void>;

  /** Batch path. The store falls back to per-row upsert when absent. */
  upsertBatch?(
    rows: Array<{ row: CodingAgentSessionRow; retentionDays?: number }>,
  ): Promise<void>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentSessionRepository
  implements CodingAgentSessionRepository
{
  async upsert(): Promise<void> {
    // no-op
  }
}
