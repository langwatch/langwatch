import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";
import { CodingAgentTraceSessionRepository } from "../coding-agent-trace-session.repository.ts";
import { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";

/** The trace-to-session mapping, held in the process. */
export class MemoryCodingAgentTraceSessionRepository extends CodingAgentTraceSessionRepository {
  static create(memory: MemoryCodingAgentDatabase): MemoryCodingAgentTraceSessionRepository {
    return new MemoryCodingAgentTraceSessionRepository(memory);
  }

  private constructor(private readonly memory: MemoryCodingAgentDatabase) {
    super();
  }

  async ensure(records: CodingAgentTraceSessionRecord[], _retentionDays: number): Promise<void> {
    for (const record of records) {
      this.memory.traceSessions.set(
        MemoryCodingAgentDatabase.key(record.tenantId, record.traceId),
        record,
      );
    }
  }

  async findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null> {
    return (
      this.memory.traceSessions.get(
        MemoryCodingAgentDatabase.key(input.tenantId, input.traceId),
      ) ?? null
    );
  }
}
