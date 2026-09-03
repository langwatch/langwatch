import type {
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";

/** Private persistence port for the ordered session event read model. */
export abstract class CodingAgentSessionEventRepository {
  abstract ensure(records: CodingAgentSessionEventRecord[], retentionDays: number): Promise<void>;

  abstract findBySessionId(input: {
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
   * The sessions whose stamped fact rows name one repository's branches: the
   * discovery read that finds a session for a pull request even after the
   * session's own row moved on to another repository. Returns distinct
   * (tenantId, sessionId) pairs only; the caller fetches the session rows.
   */
  abstract listSessionsByStampedBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<Array<{ tenantId: string; sessionId: string }>>;
}

/**
 * One (session, model, working context) group's totals. The context fields are
 * '' for rows written before the session declared where it was working (or
 * before the stamp existed); those unstamped totals are priced under the
 * legacy whole-session rule.
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

export class NullCodingAgentSessionEventRepository extends CodingAgentSessionEventRepository {
  async ensure(): Promise<void> {}

  async findBySessionId(): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return { events: [], nextCursor: null };
  }

  async sumTokensByModelPerSession(): Promise<SessionModelTotalsRow[]> {
    return [];
  }

  async listSessionsByStampedBranch(): Promise<Array<{ tenantId: string; sessionId: string }>> {
    return [];
  }
}
