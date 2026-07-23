import { createLogger } from "@langwatch/observability";
import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionState,
  projectCodingAgentSessionToRow,
} from "./codingAgentSession.foldProjection";

const logger = createLogger(
  "langwatch:coding-agent:session-fold-store",
);

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
   * Read the last committed state back (ADR-066). Dumb read/write — the `State`
   * column IS the data: the row's analytics columns are a lossy aggregate, but
   * `State` carries the whole serialized fold state (including `subAgentIds`,
   * `previousCallContextTokens` and `metricSeries`, which the columns drop), so
   * the read-back is EXACT — no ordering rule or first-seen identity is lost.
   *
   * This is what makes the fold's `refoldOnStoreMiss` unnecessary: a cache miss
   * returns the real prior state, not null, so the executor applies the
   * delivered events on top of it instead of walking the aggregate's entire
   * event_log history (the 2026-07-23 outage). A genuinely new aggregate has no
   * row (or an empty blob) → return null so the framework calls `init()`.
   *
   * A corrupt blob degrades to init rather than throwing: a parse failure must
   * not wedge the group. It re-derives from the delivered events onward — lossy
   * for that one session, but the group keeps moving.
   */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<CodingAgentSessionState | null> {
    const row = await this.repo.findBySessionId({
      tenantId: String(context.tenantId),
      sessionId: aggregateId,
    });
    if (!row || !row.state) return null;

    try {
      return JSON.parse(row.state) as CodingAgentSessionState;
    } catch (error) {
      logger.warn(
        { error, tenantId: String(context.tenantId), sessionId: aggregateId },
        "failed to parse stored coding-agent session state; degrading to init",
      );
      return null;
    }
  }
}
