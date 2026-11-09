import type { Authorization } from "@langwatch/authorization";
import type {
  CodingAgentSession,
  CodingAgentSessionBranchRecord,
  CodingAgentUsageCount,
} from "@langwatch/coding-agent-contract";

export type CodingAgentSessionListReadOutcome = "hit" | "empty" | "error";

/** The other sessions a tenant holds: a main-thread one, only helper threads, or none. */
export type OtherSessionKind = "none" | "helpers_only" | "main";

/** A read that consults the session id index for its `StartedAt` bound (ADR-071 amendment). */
export type SessionIdIndexRead =
  | "other_session_kind"
  | "recent_list"
  | "recent_list_fenced"
  | "branch_list"
  | "usage_count";

/** Observes the bounded session-list storage read without coupling the feature to app metrics. */
export interface CodingAgentReadMetrics {
  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void;
  /** One read that found the session id index not ready on its target. */
  countSessionIdIndexNotReady(input: { read: SessionIdIndexRead }): void;
}

/** The session id index is not ready, so a read that may not scan unbounded refused to run. */
export class SessionIdIndexNotReadyError extends Error {
  constructor({ read }: { read: SessionIdIndexRead }) {
    super(`the coding-agent session id index is not ready for ${read}`);
    this.name = "SessionIdIndexNotReadyError";
  }
}

/** Private persistence port for the session aggregate read model. */
export abstract class CodingAgentSessionRepository {
  abstract upsert(
    row: CodingAgentSession,
    retentionDays: number,
    appliedEventIds: readonly string[],
  ): Promise<void>;

  abstract upsertBatch(
    rows: {
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }[],
  ): Promise<void>;

  abstract findBySessionId(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSession | null>;

  abstract findBySessionIdWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null>;

  /**
   * What kind of other session the tenant holds besides those named: a main-thread one, only
   * helper threads, or none. "none" means nothing in retention, not "no history ever". Throws
   * `SessionIdIndexNotReadyError` rather than scan the tenant's history unbounded.
   */
  abstract findOtherSessionKind(input: {
    tenantId: string;
    excludeSessionIds: string[];
  }): Promise<OtherSessionKind>;

  abstract findManyRecent(input: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]>;

  /**
   * The same page through a proof's fence (ADR-177): every project the proof
   * names, a shared one cut to its grant's window on `StartedAt`.
   */
  abstract findManyRecentFenced(input: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]>;

  /** The minimal cross-project session row used by pull-request rollups. */
  abstract findByRepositoryBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]>;

  /**
   * The same rows as `findByRepositoryBranch`, fetched by session id: the
   * read behind fact-stamp discovery, where a session's stamped rows name a
   * repository its own row has since moved away from.
   */
  abstract findBySessionIds(input: {
    tenantIds: string[];
    sessionIds: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]>;

  /** The usage report's figures, one project at a time and added up. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<CodingAgentUsageCount>;
}
