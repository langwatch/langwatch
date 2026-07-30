/**
 * How far either side of a caller's `startedAtMs` hint a session read looks —
 * the same width the coding-agent session fold declares for its own store read.
 */
export const CODING_AGENT_SESSION_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One converged metric unit, as it rides in the row's `MetricSeries` column
 * (migration 00053). Mirrors the fold's metric-series fact but with the
 * nullable attribute fields flattened to empty strings for the ClickHouse
 * tuple; they map back to null on read-back.
 */
export interface CodingAgentSessionMetricSeriesRow {
  seriesId: string;
  metricName: string;
  type: string;
  decision: string;
  language: string;
  value: number;
}

/**
 * The row that lands in `coding_agent_sessions` (migration 00051, extended by
 * 00053). Field names mirror the ClickHouse columns 1:1 so the repository's
 * record literal is a straight mapping.
 */
export interface CodingAgentSessionRow {
  tenantId: string;
  sessionId: string;
  sessionKeySource: string;
  version: string;
  startedAtMs: number;

  agent: string;
  agentVersion: string;
  /** Every trace that contributed — bounded, first-seen order. */
  traceIds: string[];
  finalRequestId: string;
  userId: string;
  terminalType: string;
  entrypoint: string;

  modelCalls: number;
  toolCalls: number;
  subAgents: number;
  prompts: number;
  promptChars: number;
  responseChars: number;
  /** `(name, count, failed)`, in the order they happened. */
  steps: [string, number, boolean][];

  toolCounts: Record<string, number>;
  toolDurationMs: Record<string, number>;
  filesTouched: string[];
  skills: string[];
  subAgentTypes: string[];
  slashCommands: string[];
  models: string[];
  mcpServers: string[];
  mcpTools: string[];

  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;

  modelCallMs: number;
  toolMs: number;
  ttftMsTotal: number;
  ttftSamples: number;
  blockedOnUserMs: number;
  activeTimeUserSec: number;
  activeTimeCliSec: number;

  toolResultBytes: number;
  toolInputBytes: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;
  peakContextTokens: number;
  cacheRebuildCount: number;
  largestCacheRebuildTokens: number;

  failedTools: number;
  errorTypes: Record<string, number>;
  apiErrors: number;
  rateLimited: number;
  retriesExhausted: number;
  retryMs: number;
  attempts: number;
  refusals: number;
  refusalCategories: string[];
  internalErrors: number;

  toolsDenied: number;
  toolsAborted: number;
  permissionMode: string;
  permissionChanges: number;
  hooksBlocked: number;
  hooksCancelled: number;
  hookMs: number;

  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  editsAccepted: number;
  editsRejected: number;
  languagesEdited: string[];
  atMentions: number;

  stopReason: string;
  truncated: boolean;

  // ── Read-back state (ADR-099, migration 00053) ─────────────────────────
  // Not analytics columns — these round-trip the fold's working state so
  // store.get() can read it back (decode the row) without replaying event_log.
  /** The dedup set behind `subAgents`; the row keeps count + types, plus this. */
  subAgentIds: string[];
  /** Per-step start times, index-aligned with `steps` (dropped by the 3-tuple). */
  stepStartedAt: number[];
  /** Previous model call's context size, to detect the next cache rebuild. */
  previousCallContextTokens: number;
  /** The converged metric units the metric-fed fields are recomputed from. */
  metricSeries: CodingAgentSessionMetricSeriesRow[];
  /** Fold bookkeeping timestamps (createdAt/updatedAt map to CreatedAt/UpdatedAt). */
  createdAt: number;
  updatedAt: number;
  lastEventOccurredAt: number;
}

/**
 * Persistence for the coding-agent session row (ADR-056, migration 00051).
 *
 * One row per session. Idempotent by construction: the table is a
 * ReplacingMergeTree(UpdatedAt) and every read dedups to the latest UpdatedAt
 * per (TenantId, SessionId), so a re-fold simply writes a newer version.
 */
export interface CodingAgentSessionRepository {
  /**
   * `appliedEventIds` is the executor's redelivery-dedup watermark (ADR-066,
   * migration 00054): the ids folded into this write, persisted next to the row
   * so a retry with a cold cache still recognises a batch it already committed.
   * Not part of the row — it is fold bookkeeping, not session state.
   */
  upsert(
    row: CodingAgentSessionRow,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void>;

  /** Batch path. The store falls back to per-row upsert when absent. */
  upsertBatch?(
    rows: Array<{
      row: CodingAgentSessionRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void>;

  /**
   * One session, or null. `window` bounds StartedAt so ClickHouse prunes
   * partitions — without it every partition is scanned, including cold
   * storage. The repository applies the window it is given verbatim; it is a
   * pruning optimisation only, so a caller that cannot rule out a row outside
   * its window must retry without one (the fold path gets that retry from the
   * executor's declared-read-window contract).
   */
  findBySessionId(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSessionRow | null>;

  /**
   * The same session as `findBySessionId`, plus the applied-event-id watermark
   * persisted next to it (ADR-066, migration 00054). Same query — the read-back
   * store uses this on a cache miss so a retry can dedup a redelivered batch
   * without the cache. Null when no row exists.
   */
  findBySessionIdWithApplied(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: CodingAgentSessionRow; appliedEventIds: string[] } | null>;

  /**
   * A project's coding-agent sessions in a period, newest first. The time
   * range is required — it is the partition filter, and usage is always
   * asked about a period.
   *
   * `userId` narrows to sessions the AGENT reported under that id — an opaque
   * provider id only (`user.id`, `user.account_uuid`, `user.account_id`),
   * which is the agent's identity space rather than the LangWatch account.
   * Deliberately NOT `user.email`: it rides the same events but is raw human
   * identity, and this value lands verbatim in a durable row, so the fold
   * never reads it. Omit for personal-workspace usage, where the personal
   * project already isolates the user's sessions.
   *
   * Narrowing is applied outside the dedup scope, so a session whose newest
   * version reports no user leaves the filtered list rather than answering
   * from a superseded version — see the ClickHouse repository's docblock.
   */
  findManyRecent(params: {
    tenantId: string;
    userId?: string;
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

  async findBySessionIdWithApplied(): Promise<{
    row: CodingAgentSessionRow;
    appliedEventIds: string[];
  } | null> {
    return null;
  }

  async findManyRecent(): Promise<CodingAgentSessionRow[]> {
    return [];
  }
}
