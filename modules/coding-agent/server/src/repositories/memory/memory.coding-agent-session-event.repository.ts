import type {
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";
import {
  CodingAgentSessionEventRepository,
  type SessionModelTotalsRow,
} from "../coding-agent-session-event.repository.ts";
import { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";

/** The ordered session event read model, held in the process. */
export class MemoryCodingAgentSessionEventRepository extends CodingAgentSessionEventRepository {
  static create(memory: MemoryCodingAgentDatabase): MemoryCodingAgentSessionEventRepository {
    return new MemoryCodingAgentSessionEventRepository(memory);
  }

  private constructor(private readonly memory: MemoryCodingAgentDatabase) {
    super();
  }

  async ensure(records: CodingAgentSessionEventRecord[], _retentionDays: number): Promise<void> {
    for (const record of records) {
      const existing = this.memory.sessionEvents.findIndex(
        (held) =>
          held.tenantId === record.tenantId &&
          held.sessionId === record.sessionId &&
          held.recordId === record.recordId,
      );
      if (existing === -1) this.memory.sessionEvents.push(record);
      else this.memory.sessionEvents[existing] = record;
    }
  }

  async findBySessionId(input: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: CodingAgentSessionCursor;
    limit: number;
  }): Promise<{ events: CodingAgentSessionEvent[]; nextCursor: CodingAgentSessionCursor | null }> {
    const matching = this.memory.sessionEvents
      .filter((held) => held.tenantId === input.tenantId && held.sessionId === input.sessionId)
      .filter((held) => !input.kinds || input.kinds.includes(held.eventKind))
      .filter(
        (held) =>
          !input.occurredAt ||
          (held.timeUnixMs >= input.occurredAt.fromMs && held.timeUnixMs <= input.occurredAt.toMs),
      )
      .filter((held) => !input.cursor || isAfter(held, input.cursor))
      .sort(byTimeThenRecordId);

    const page = matching.slice(0, input.limit);
    const last = page.at(-1);
    const more = matching.length > page.length;

    return {
      events: page.map(asEvent),
      nextCursor:
        more && last ? { timeUnixMs: last.timeUnixMs, recordId: last.recordId } : null,
    };
  }

  /**
   * The memory tier stamps no working context, so every total is reported
   * unstamped - the same "" the ClickHouse rows carry for calls made before a
   * session declared where it was working.
   */
  async sumTokensByModelPerSession(input: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<SessionModelTotalsRow[]> {
    const totals = new Map<string, SessionModelTotalsRow>();

    for (const held of this.memory.sessionEvents) {
      if (!input.tenantIds.includes(held.tenantId)) continue;
      if (!input.sessionIds.includes(held.sessionId)) continue;
      if (held.timeUnixMs < input.fromMs) continue;

      const key = `${held.tenantId}:${held.sessionId}:${held.model}`;
      const row = totals.get(key) ?? emptyTotals(held);
      row.inputTokens += held.inputTokens;
      row.outputTokens += held.outputTokens;
      row.cacheReadTokens += held.cacheReadTokens;
      row.cacheCreationTokens += held.cacheCreationTokens;
      row.costUsd += held.costUsd;
      totals.set(key, row);
    }

    return [...totals.values()];
  }

  /** Fact stamps are a ClickHouse-side projection; this tier holds none. */
  async listSessionsByStampedBranch(): Promise<Array<{ tenantId: string; sessionId: string }>> {
    return [];
  }
}

function emptyTotals(held: CodingAgentSessionEventRecord): SessionModelTotalsRow {
  return {
    tenantId: held.tenantId,
    sessionId: held.sessionId,
    model: held.model,
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    branch: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

function asEvent(record: CodingAgentSessionEventRecord): CodingAgentSessionEvent {
  const { tenantId: _tenantId, ...event } = record;
  return event;
}

function isAfter(
  record: CodingAgentSessionEventRecord,
  cursor: CodingAgentSessionCursor,
): boolean {
  if (record.timeUnixMs !== cursor.timeUnixMs) return record.timeUnixMs > cursor.timeUnixMs;
  return record.recordId > cursor.recordId;
}

function byTimeThenRecordId(
  left: CodingAgentSessionEventRecord,
  right: CodingAgentSessionEventRecord,
): number {
  if (left.timeUnixMs !== right.timeUnixMs) return left.timeUnixMs - right.timeUnixMs;
  return left.recordId.localeCompare(right.recordId);
}
