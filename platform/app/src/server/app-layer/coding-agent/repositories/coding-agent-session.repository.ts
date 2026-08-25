import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";

/**
 * One session as the pull-request rollup reads it: the numbers it adds up, the
 * labels it groups by, and the one-line title the agent generated for it. No
 * file list and no transcript: this row exists to be summed, grouped and
 * named, and everything it does not carry is something the usage response can
 * never accidentally disclose.
 *
 * The title is conversation-derived content, so whether a reader gets to see
 * it is decided at the read boundary against the protections of the project
 * the session ran in, never here.
 */
export interface CodingAgentBranchSessionRow {
  sessionId: string;
  tenantId: string;
  startedAtMs: number;
  /**
   * When the session last produced an event, epoch ms, 0 when it never did.
   * A long session's start time says when it began, not when it was last worked
   * in, so this is what "last activity" is read from.
   */
  lastEventOccurredAtMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  agent: string;
  models: string[];
  /** The AGENT's reported identity, not the LangWatch account. */
  userId: string;
  gitBranch: string;
  /**
   * Every branch the session drove, first seen first. Empty for a row folded
   * before the column existed, where `gitBranch` is the whole of what is known;
   * read both through `branchesOf` rather than either one alone.
   */
  gitBranches: string[];
  /** The generated conversation title, empty when the agent never made one. */
  title: string;
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

  /**
   * The sessions that ran on one repository's branches, across several
   * projects of ONE organization: the read behind pull-request usage.
   *
   * `startedAtFromMs` is required: without a bound on the partition key this
   * read opens every partition the retention holds. Carries only the columns
   * the rollup sums and groups by, never content.
   */
  listByRepositoryBranch(params: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentBranchSessionRow[]>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentSessionRepository implements CodingAgentSessionRepository {
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

  async listByRepositoryBranch(): Promise<CodingAgentBranchSessionRow[]> {
    return [];
  }
}
