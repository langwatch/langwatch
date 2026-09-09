/** Private persistence port for the trace-to-session projection. */
import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";

export abstract class CodingAgentTraceSessionRepository {
  abstract ensure(records: CodingAgentTraceSessionRecord[], retentionDays: number): Promise<void>;

  abstract findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null>;
}

export class NullCodingAgentTraceSessionRepository extends CodingAgentTraceSessionRepository {
  async ensure(): Promise<void> {}

  async findByTraceId(): Promise<CodingAgentTraceSessionRecord | null> {
    return null;
  }
}
