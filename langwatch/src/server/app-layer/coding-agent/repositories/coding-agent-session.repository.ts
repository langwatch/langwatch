import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";

/**
 * Persistence for the coding-agent session row (ADR-056, migration 00051).
 *
 * One row per session. Idempotent by construction: the table is a
 * ReplacingMergeTree(UpdatedAt) and every read dedups to the latest UpdatedAt
 * per (TenantId, SessionId), so a re-fold simply writes a newer version.
 */
export interface CodingAgentSessionRepository {
  upsert(row: CodingAgentSessionRow, retentionDays?: number): Promise<void>;

  /** Batch path. The store falls back to per-row upsert when absent. */
  upsertBatch?(
    rows: Array<{ row: CodingAgentSessionRow; retentionDays?: number }>,
  ): Promise<void>;

  /**
   * One session, or null. `startedAtMs` is the partition-pruning hint —
   * without it ClickHouse scans every partition, including cold storage.
   */
  findBySessionId(params: {
    tenantId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSessionRow | null>;

  /**
   * One user's sessions in a period, newest first. The time range is
   * required: it is the partition filter, and "my usage" is always asked
   * about a period.
   */
  findManyByUser(params: {
    tenantId: string;
    userId: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSessionRow[]>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentSessionRepository
  implements CodingAgentSessionRepository
{
  async upsert(): Promise<void> {
    // no-op
  }

  async findBySessionId(): Promise<CodingAgentSessionRow | null> {
    return null;
  }

  async findManyByUser(): Promise<CodingAgentSessionRow[]> {
    return [];
  }
}
