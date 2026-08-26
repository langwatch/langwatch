import type {
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";

/** Private persistence port for the ordered session event read model. */
export abstract class CodingAgentSessionEventRepository {
  abstract ensure(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void>;

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
}

export interface SessionModelTotalsRow {
  tenantId: string;
  sessionId: string;
  model: string;
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
}
