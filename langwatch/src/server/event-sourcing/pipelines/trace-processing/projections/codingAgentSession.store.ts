import type { CodingAgentSessionRepository } from "~/server/app-layer/traces/repositories/coding-agent-session.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionState,
  projectCodingAgentSessionToRow,
} from "./codingAgentSession.foldProjection";
import { isCodingAgentSession } from "./services/coding-agent-session.derivation";

/**
 * FoldProjectionStore adapter for the coding-agent session fold (ADR-041).
 *
 * The gate matters: a trace that is not a coding-agent session never reaches the
 * table. Every trace in the project flows through this fold, so without the
 * check an ordinary LLM trace would write an empty row for itself and the table
 * would be mostly noise. `isCodingAgentSession` is true only once the fold has
 * actually seen a model call or a tool run — which no chat trace produces, since
 * the agent's span names are what the derivation keys on.
 */
export class CodingAgentSessionStore
  implements FoldProjectionStore<CodingAgentSessionState>
{
  constructor(private readonly repo: CodingAgentSessionRepository) {}

  async store(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const row = this.toRow(state, context);
    if (row === null) return;
    await this.repo.upsert(
      row.row,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async storeBatch(
    entries: Array<{
      state: CodingAgentSessionState;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const rows = entries
      .map(({ state, context }) => this.toRow(state, context))
      .filter((r): r is { row: ReturnType<typeof projectCodingAgentSessionToRow>; retentionDays: number } => r !== null);

    if (rows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(rows);
      return;
    }
    await Promise.all(
      rows.map(({ row, retentionDays }) => this.repo.upsert(row, retentionDays)),
    );
  }

  private toRow(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof projectCodingAgentSessionToRow>;
    retentionDays: number;
  } | null {
    // Not a coding agent — write nothing at all.
    if (!isCodingAgentSession(state)) return null;

    const withId: CodingAgentSessionState = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };

    return {
      row: projectCodingAgentSessionToRow({
        state: withId,
        tenantId: String(context.tenantId),
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
