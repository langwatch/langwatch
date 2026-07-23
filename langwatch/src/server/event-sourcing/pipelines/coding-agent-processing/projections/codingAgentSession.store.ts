import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionState,
  codingAgentSessionStateFromRow,
  projectCodingAgentSessionToRow,
} from "./codingAgentSession.foldProjection";

/**
 * FoldProjectionStore adapter for the coding-agent session fold (ADR-056).
 *
 * Unlike PR #5708's trace-keyed store there is no "is this a coding agent"
 * gate here: the dispatchers on the source pipelines are the gate, so every
 * event this fold sees is a coding-agent contribution and every folded state
 * is a session worth a row — including a metric-only session, which has zero
 * model calls and zero tool runs and must still appear
 * (specs/coding-agent/session-aggregate.feature).
 */
export class CodingAgentSessionStore
  implements FoldProjectionStore<CodingAgentSessionState>
{
  constructor(private readonly repo: CodingAgentSessionRepository) {}

  async store(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const result = this.toRow(state, context);
    await this.repo.upsert(result.row, result.retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: CodingAgentSessionState;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const rows = entries.map(({ state, context }) =>
      this.toRow(state, context),
    );
    if (rows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(rows);
      return;
    }
    await Promise.all(
      rows.map(({ row, retentionDays }) =>
        this.repo.upsert(row, retentionDays),
      ),
    );
  }

  private toRow(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof projectCodingAgentSessionToRow>;
    retentionDays: number;
  } {
    return {
      row: projectCodingAgentSessionToRow({
        state,
        tenantId: String(context.tenantId),
        sessionId: String(context.aggregateId),
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      }),
      retentionDays:
        context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    };
  }

  /**
   * Read the session's last committed state back (ADR-066) — the CH-fallthrough
   * side of the read path: `RedisCachedFoldStore` serves the warm cache and only
   * calls this on a miss. The row round-trips the full working state — counters,
   * ordered steps (with their start times), the sub-agent dedup set, the
   * previous-call context size, and the converged metric units — so a miss reads
   * ONE point row and decodes it. It never replays `event_log`; that is the
   * offline rebuild path, not this one.
   *
   * `context.occurredAtMs` prunes the read to a window of partitions around the
   * event being folded; absent, the repository scans (still keyed, still
   * correct — just not partition-pruned).
   */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<CodingAgentSessionState | null> {
    const row = await this.repo.findBySessionId({
      tenantId: String(context.tenantId),
      sessionId: aggregateId,
      startedAtMs: context.occurredAtMs,
    });
    return row ? codingAgentSessionStateFromRow(row) : null;
  }
}
