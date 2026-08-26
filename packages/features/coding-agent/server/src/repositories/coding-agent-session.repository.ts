import type {
  CodingAgentSession,
  CodingAgentSessionBranchRecord,
} from "@langwatch/coding-agent-contract";

/** Private persistence port for the session aggregate read model. */
export abstract class CodingAgentSessionRepository {
  abstract upsert(
    row: CodingAgentSession,
    retentionDays: number,
    appliedEventIds: readonly string[],
  ): Promise<void>;

  abstract upsertBatch(
    rows: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void>;

  abstract tryFindBySessionId(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSession | null>;

  abstract tryFindBySessionIdWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null>;

  abstract findManyRecent(input: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]>;

  /** The minimal cross-project session row used by pull-request rollups. */
  abstract listByRepositoryBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]>;
}

export class NullCodingAgentSessionRepository extends CodingAgentSessionRepository {
  async upsert(): Promise<void> {}

  async upsertBatch(): Promise<void> {}

  async tryFindBySessionId(): Promise<CodingAgentSession | null> {
    return null;
  }

  async tryFindBySessionIdWithApplied(): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null> {
    return null;
  }

  async findManyRecent(): Promise<CodingAgentSession[]> {
    return [];
  }

  async listByRepositoryBranch(): Promise<CodingAgentSessionBranchRecord[]> {
    return [];
  }
}
