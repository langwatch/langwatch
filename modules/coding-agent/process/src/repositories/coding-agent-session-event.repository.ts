import type {
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
}
