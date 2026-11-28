import type { TraceAgentSeen } from "@langwatch/trace-contract";

/** The agents a project's spans name (`gen_ai.agent.name`), read from stored spans. */
export abstract class TraceAgentTrafficRepository {
  /** One row per distinct agent name seen since `sinceMs`, busiest first, at most `limit`. */
  abstract findAgentsSeen(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<TraceAgentSeen[]>;
}
