/** Private persistence port for the trace-to-session projection. */
import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";

export abstract class CodingAgentTraceSessionRepository {
  abstract ensure(records: CodingAgentTraceSessionRecord[], retentionDays: number): Promise<void>;

  abstract findByTraceId(input: {
    tenantId: string;
    traceId: string;
    idIndex?: IdIndexFlags | undefined;
  }): Promise<CodingAgentTraceSessionRecord | null>;
}
