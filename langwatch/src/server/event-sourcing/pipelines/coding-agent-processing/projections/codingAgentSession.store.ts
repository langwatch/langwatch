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
    const entry = this.toRow(state, context);
    await this.repo.upsert(
      entry.row,
      entry.retentionDays,
      entry.appliedEventIds,
    );
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
      rows.map(({ row, retentionDays, appliedEventIds }) =>
        this.repo.upsert(row, retentionDays, appliedEventIds),
      ),
    );
  }

  private toRow(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof projectCodingAgentSessionToRow>;
    retentionDays: number;
    appliedEventIds: string[];
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
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds
        ? [...context.appliedEventIds]
        : [],
    };
  }

  /**
   * Read the session's last committed state back together with the
   * applied-event-id watermark persisted next to it (ADR-066) — the
   * CH-fallthrough side of the read path: `RedisCachedFoldStore` serves the warm
   * cache and only calls this on a miss. The row round-trips the full working
   * state — counters, ordered steps (with their start times), the sub-agent
   * dedup set, the previous-call context size, and the converged metric units —
   * plus the watermark, so a retry that reaches a cold cache can still recognise
   * a batch it already committed. It never replays `event_log`; that is the
   * offline rebuild path, not this one.
   *
   * `context.readWindow` — computed by the executor from the fold's declared
   * `options.readWindow` — prunes the read to a window of partitions around the
   * event being folded; it is passed through verbatim. On a windowed miss the
   * EXECUTOR retries without the window, so a row outside it is still found;
   * this store neither widens the window nor implements a fallback itself.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: CodingAgentSessionState | null;
    appliedEventIds: string[];
  }> {
    const found = await this.repo.findBySessionIdWithApplied({
      tenantId: String(context.tenantId),
      sessionId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [] };
    return {
      state: codingAgentSessionStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<CodingAgentSessionState | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}
