import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
  type CodingAgentSessionRow,
  CodingAgentSessionRowMapper,
  type CodingAgentSessionState,
  CodingAgentSessionStateMapper,
} from "../projections/coding-agent-session.projection";

/**
 * Whether a committed row's read-back columns can be trusted.
 *
 * See `EventingCodingAgentSessionStoreAdapter.getWithApplied` for why the projection version is
 * not sufficient on its own, and why `lastEventOccurredAt` is a sound second
 * half of the discriminator.
 */
function carriesReadBackColumns(row: CodingAgentSessionRow): boolean {
  if (row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST) {
    return true;
  }
  return (
    row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP && row.lastEventOccurredAt > 0
  );
}

/**
 * FoldProjectionStore adapter for the coding-agent session fold (ADR-056).
 *
 * Unlike PR #5708's trace-keyed store there is no "is this a coding agent"
 * gate here: the dispatchers on the source pipelines are the gate, so every
 * event this fold sees is a coding-agent contribution and every folded state
 * is a session worth a row — including a metric-only session, which has zero
 * model calls and zero tool runs and must still appear
 * (specs/coding-agent/session-aggregate.feature).
 *
 * Read-back (ADR-066): `get`/`getWithApplied` decode the last committed row
 * (typed read-back columns, migrations 00053/00054) so the delivery path does
 * not refold from `event_log`; the applied-event-id watermark rides next to the
 * row so a cold-cache retry still dedups a redelivered batch. Decoding is gated
 * on whether the row actually carries those columns — see `getWithApplied`.
 */
export class EventingCodingAgentSessionStoreAdapter implements FoldProjectionStore<CodingAgentSessionState> {
  private constructor(
    private readonly persistence: CodingAgentProjectionPersistence,
    private readonly hooks: {
      defaultRetentionDays: number;
      /**
       * Called after a commit with the distinct tenants whose sessions were
       * stored — the seam the project's Sessions-destination stamp rides
       * (`createCodingAgentSessionSeenTouch`). Fire-and-forget: the callback
       * owns its own errors and throttling, and the committed row must never
       * wait on it.
       */
      onSessionsStored?: (tenantIds: string[]) => Promise<void>;
    },
  ) {}

  static create(input: {
    persistence: CodingAgentProjectionPersistence;
    defaultRetentionDays: number;
    onSessionsStored?: (tenantIds: string[]) => Promise<void>;
  }): EventingCodingAgentSessionStoreAdapter {
    return new EventingCodingAgentSessionStoreAdapter(input.persistence, {
      defaultRetentionDays: input.defaultRetentionDays,
      onSessionsStored: input.onSessionsStored,
    });
  }

  async store(state: CodingAgentSessionState, context: ProjectionStoreContext): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const entry = this.toRow(state, context);
    await this.persistence.storeSession(entry);
    this.reportSessionsStored([String(context.tenantId)]);
  }

  async storeBatch(
    entries: Array<{
      state: CodingAgentSessionState;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const persistable = entries.filter(({ state }) => hasPersistableSignal(state));
    const rows = persistable.map(({ state, context }) => this.toRow(state, context));
    if (rows.length === 0) return;

    const tenantIds = [...new Set(persistable.map(({ context }) => String(context.tenantId)))];
    await this.persistence.storeSessionBatch(rows);
    this.reportSessionsStored(tenantIds);
  }

  /**
   * Fire-and-forget by contract: the callback logs and swallows its own
   * failures (`createCodingAgentSessionSeenTouch`), and the committed row must
   * never wait on it — but a hook that rejects anyway must surface as nothing
   * worse than a dropped stamp, not as an unhandled rejection in the worker.
   */
  private reportSessionsStored(tenantIds: string[]): void {
    void this.hooks.onSessionsStored?.(tenantIds).catch(() => undefined);
  }

  private toRow(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): {
    row: CodingAgentSessionRow;
    retentionDays: number;
    appliedEventIds: string[];
  } {
    return {
      row: CodingAgentSessionRowMapper.toRow({
        state,
        tenantId: String(context.tenantId),
        sessionId: String(context.aggregateId),
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      }),
      retentionDays: context.retentionPolicy?.traces ?? this.hooks.defaultRetentionDays,
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds ? [...context.appliedEventIds] : [],
    };
  }

  /**
   * Cold-cache reads carry the state and delivery watermark together. Rows from
   * before migration 00053 lack essential read-back columns and must be an
   * `undecodable` miss so one refold rebuilds them; an absent windowed row is
   * the only miss the executor retries without the window. The pre-bump stamp
   * is accepted only with positive `LastEventOccurredAt`, whose UTC-decoded
   * default distinguishes old rows from a populated checkpoint.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: CodingAgentSessionState | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.persistence.loadSessionWithApplied({
      tenantId: String(context.tenantId),
      sessionId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: the read-back columns did not exist when this row
    // was written, so decoding it would fabricate state. Answer as for "no row"
    // — the watermark is dropped too, because a watermark without the state it
    // belongs to would suppress the very events the re-fold needs — but report
    // it as `undecodable`, not `absent`: the row was FOUND and refused, so the
    // executor must not answer with an unwindowed re-read that can only find
    // the same row again.
    if (!carriesReadBackColumns(found.row)) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: CodingAgentSessionStateMapper.fromRow(found.row),
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

/**
 * A session state is worth a row once the session has said something: a
 * prompt, a model or tool call, tokens, cost, a name, or the repository it
 * works in. An agent that starts and dies before its first prompt still
 * emits lifecycle and error telemetry, and folding that minted untitled
 * rows with a dash in every column — twelve of them in one boot when a
 * fleet's agents all resumed against an expired credential. The canonical
 * records stay stored either way; the contributions before the first real
 * signal are the price of not storing the noise, and they amount to
 * lifecycle timing nothing reads.
 */
function hasPersistableSignal(state: CodingAgentSessionState): boolean {
  return (
    state.prompts > 0 ||
    state.modelCalls > 0 ||
    state.toolCalls > 0 ||
    state.subAgents > 0 ||
    state.inputTokens > 0 ||
    state.outputTokens > 0 ||
    state.costUsd > 0 ||
    // A metrics-only session must still appear
    // (specs/coding-agent/session-aggregate.feature) — its tokens and cost
    // usually say so, and the work counters cover one that reported neither.
    state.linesAdded > 0 ||
    state.linesRemoved > 0 ||
    state.commits > 0 ||
    state.pullRequests > 0 ||
    state.editsAccepted > 0 ||
    state.editsRejected > 0 ||
    (state.title !== null && state.title !== "") ||
    (state.repositoryName !== null && state.repositoryName !== "")
  );
}
