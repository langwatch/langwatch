/** Private persistence port for the trace-to-session projection. */
import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";

export abstract class CodingAgentTraceSessionRepository {
  abstract ensure(records: CodingAgentTraceSessionRecord[], retentionDays: number): Promise<void>;

  abstract tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null>;
}

export class NullCodingAgentTraceSessionRepository extends CodingAgentTraceSessionRepository {
  async ensure(): Promise<void> {}

  async tryFindByTraceId(): Promise<CodingAgentTraceSessionRecord | null> {
    return null;
  }
}
