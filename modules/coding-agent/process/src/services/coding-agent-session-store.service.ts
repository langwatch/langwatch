import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import type {
  FoldProjectionStore,
  ProjectionStoreContext,
  FoldStateRead,
} from "@langwatch/eventing";

import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
} from "../eventing/coding-agent-session.projection.ts";
import { toCodingAgentSessionRow } from "../rules/coding-agent-session-row-mapper.rules.ts";
import { codingAgentSessionStateFromRow } from "../rules/coding-agent-session-state-mapper.rules.ts";

/**
 * Whether a committed row's read-back columns can be trusted. Projection
 * version alone is not sufficient (see `getWithApplied`); `lastEventOccurredAt`
 * is the sound second half of the discriminator.
 */
function carriesReadBackColumns(row: CodingAgentSessionRow): boolean {
  if (row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST) {
    return true;
  }
  return (
    row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP && row.lastEventOccurredAt > 0
  );
}

/** What a committed fold step tells the sessions-stored hook, one entry per session. */
export interface StoredSession {
  tenantId: string;
  sessionId: string;
  /** The product id (`claude_code`, `codex`); null until a span or log names it. */
  agent: string | null;
  /** The session's own last event time, epoch ms. */
  occurredAt: number;
  /** When the session was first folded (set at fold init, kept on read-back), epoch ms. */
  firstStoredAt: number;
  auxiliary: boolean;
}

/** Store adapter; no agent gate (dispatchers gate upstream), read-back decoding per ADR-066. */
export class EventingCodingAgentSessionStoreService implements FoldProjectionStore<CodingAgentSessionState> {
  private constructor(
    private readonly persistence: CodingAgentProjectionPersistence,
    private readonly hooks: {
      defaultRetentionDays: () => number;
      /**
       * Called after a commit with the sessions stored: the seam the activity stamp
       * and the session-stored fact ride. Fire-and-forget: the callback owns its own
       * errors, never blocking the committed row.
       */
      onSessionsStored?: (sessions: StoredSession[]) => Promise<void>;
    },
  ) {}

  static create(input: {
    persistence: CodingAgentProjectionPersistence;
    defaultRetentionDays: () => number;
    onSessionsStored?: (sessions: StoredSession[]) => Promise<void>;
  }): EventingCodingAgentSessionStoreService {
    return new EventingCodingAgentSessionStoreService(input.persistence, {
      defaultRetentionDays: input.defaultRetentionDays,
      onSessionsStored: input.onSessionsStored,
    });
  }

  async store(state: CodingAgentSessionState, context: ProjectionStoreContext): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const entry = this.toRow(state, context);
    await this.persistence.storeSession(entry);
    this.reportSessionsStored([toStoredSession(state, context)]);
  }

  async storeBatch(
    entries: {
      state: CodingAgentSessionState;
      context: ProjectionStoreContext;
    }[],
  ): Promise<void> {
    const persistable = entries.filter(({ state }) => hasPersistableSignal(state));
    const rows = persistable.map(({ state, context }) => this.toRow(state, context));
    if (rows.length === 0) return;

    await this.persistence.storeSessionBatch(rows);
    this.reportSessionsStored(
      persistable.map(({ state, context }) => toStoredSession(state, context)),
    );
  }

  /** Fire-and-forget: a rejecting hook costs a dropped stamp, never an unhandled rejection. */
  private reportSessionsStored(sessions: StoredSession[]): void {
    void this.hooks.onSessionsStored?.(sessions).catch(() => undefined);
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
      row: toCodingAgentSessionRow({
        state,
        tenantId: String(context.tenantId),
        sessionId: String(context.aggregateId),
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      }),
      retentionDays: context.retentionPolicy?.traces ?? this.hooks.defaultRetentionDays(),
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds ? [...context.appliedEventIds] : [],
    };
  }

  /**
   * Rows from before migration 00053 lack read-back columns, so they must
   * report `undecodable` — not `absent` — so a refold rebuilds them instead
   * of the executor retrying with an unwindowed re-read.
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
    if (found.kind === "miss") return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: read-back columns didn't exist when this row was
    // written, so decoding it would fabricate state. The watermark is dropped
    // too — one without its state would suppress events the re-fold needs —
    // and reported as `undecodable`, not `absent`, so the executor doesn't
    // retry with an unwindowed re-read that finds the same row again.
    if (!carriesReadBackColumns(found.row)) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: codingAgentSessionStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<CodingAgentSessionState>> {
    const { state } = await this.getWithApplied(aggregateId, context);

    return state === null ? { kind: "empty" } : { kind: "folded", state };
  }
}

function toStoredSession(
  state: CodingAgentSessionState,
  context: ProjectionStoreContext,
): StoredSession {
  return {
    tenantId: String(context.tenantId),
    sessionId: String(context.aggregateId),
    agent: state.agent,
    occurredAt: state.LastEventOccurredAt,
    firstStoredAt: state.createdAt,
    auxiliary: state.auxiliary,
  };
}

/** Session worth a row once it signals: prompt, call, tokens, cost, name, or repo. */
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
    (state.repositoryName !== null && state.repositoryName !== "") ||
    // A helper's request span can land before anything the thread said; the mark alone keeps the
    // row out of the list, so it earns a row rather than a state a cache loss could forget.
    state.auxiliary
  );
}
