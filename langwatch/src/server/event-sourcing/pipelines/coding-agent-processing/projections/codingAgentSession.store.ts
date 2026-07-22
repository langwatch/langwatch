import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionState,
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
   * No read-back: the row is an AGGREGATE, not a copy. The counters survive a
   * round-trip but the fold's ordering rules and first-seen identity semantics
   * do not, so rebuilding state from the row would quietly produce a different
   * session than replaying the events does.
   *
   * State continuity therefore comes from the two layers above this store: the
   * Redis cache it is wrapped in at registration, and the fold's
   * `refoldOnStoreMiss` option, which rebuilds from the event log on a miss.
   * Without BOTH, a delivery would fold only its own batch and a partial row
   * would overwrite a complete one.
   */
  async get(): Promise<CodingAgentSessionState | null> {
    return null;
  }
}
