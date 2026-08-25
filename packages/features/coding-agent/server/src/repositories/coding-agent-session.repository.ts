import type { CodingAgentSession } from "@langwatch/coding-agent-contract";

/** Private persistence port for the session aggregate read model. */
export abstract class CodingAgentSessionRepository {
  abstract findBySessionId(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSession | null>;

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
  }): Promise<CodingAgentSession[]>;
}
