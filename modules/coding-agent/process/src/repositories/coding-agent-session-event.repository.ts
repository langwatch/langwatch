import type { Authorization } from "@langwatch/authorization";
import type {
  CodingAgentAccountReading,
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";

/** Private persistence port for the ordered session event read model. */
export abstract class CodingAgentSessionEventRepository {
  abstract ensure(records: CodingAgentSessionEventRecord[], retentionDays: number): Promise<void>;

  abstract listBySessionId(input: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: CodingAgentSessionCursor;
    limit: number;
  }): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }>;

  abstract sumTokensByModelPerSession(input: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<SessionModelTotalsRow[]>;

  /**
   * The model calls and rate-limit rows a proof may read that name an account, deduplicated and
   * grouped by account, UTC day, agent and model, with the newest name, source and reading per
   * group.
   */
  abstract summariseAccountUsage(input: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
  }): Promise<AccountUsageGroupRow[]>;

  /**
   * The sessions whose stamped fact rows name one repository's branches: finds
   * a session for a pull request even after its own row moved to another
   * repository. Returns distinct (tenantId, sessionId) pairs; caller fetches rows.
   */
  abstract findSessionsByStampedBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<{ tenantId: string; sessionId: string }[]>;
}

/**
 * One (session, model, working context) group's totals. Context fields are
 * '' for rows written before a declaration (or before the stamp existed);
 * those unstamped totals price under the legacy whole-session rule.
 */
export interface SessionModelTotalsRow {
  tenantId: string;
  sessionId: string;
  model: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** The calls' AI units, a count beside the dollar figure; 0 for an agent that reports none. */
  aiUnits: number;
}

/** A value an account reported, with when it was reported, so groups can be merged newest first. */
interface Reported<T> {
  value: T;
  atMs: number;
}

/** One (account, UTC day, agent, model) group of an account's rows. */
export interface AccountUsageGroupRow {
  accountId: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  agent: string;
  /** '' for the rate-limit rows, which name no model. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  rateLimitEvents: number;
  name: Reported<string> | null;
  source: Reported<string> | null;
  /** The newest reading in the group; `atMs` is when it was read, else when its row happened. */
  reading: (CodingAgentAccountReading & { atMs: number }) | null;
}
