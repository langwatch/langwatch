import { AccessNotGrantedError, type Authorization } from "@langwatch/authorization";
import type {
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";

import { utcDayOf } from "../../rules/coding-agent-account.rules.ts";
import { tracesFenceOf } from "../../rules/coding-agent-traces-fence.rules.ts";
import {
  type AccountUsageGroupRow,
  CodingAgentSessionEventRepository,
  type SessionModelTotalsRow,
} from "../coding-agent-session-event.repository.ts";
import type { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";

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

  async listBySessionId(input: {
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
      .toSorted(byTimeThenRecordId);

    const page = matching.slice(0, input.limit);
    const last = page.at(-1);
    const more = matching.length > page.length;

    return {
      events: page.map(asEvent),
      nextCursor: more && last ? { timeUnixMs: last.timeUnixMs, recordId: last.recordId } : null,
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
      row.aiUnits += held.aiUnits;
      totals.set(key, row);
    }

    return [...totals.values()];
  }

  async summariseAccountUsage(input: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
  }): Promise<AccountUsageGroupRow[]> {
    const fence = tracesFenceOf(input.authorization);
    if (fence.kind === "refused") throw new AccessNotGrantedError("traces:view");
    const inFence = fence.admits;
    const groups = new Map<string, AccountUsageGroupRow>();
    const held = this.memory.sessionEvents
      .filter(
        (row) => row.accountId !== "" && inFence({ tenantId: row.tenantId, atMs: row.timeUnixMs }),
      )
      .filter((row) => row.eventKind === "model_call" || row.eventKind === "rate_limit")
      .filter((row) => row.timeUnixMs >= input.fromMs && row.timeUnixMs < input.toMs)
      .toSorted(byTimeThenRecordId);

    for (const row of held) {
      const day = utcDayOf(row.timeUnixMs);
      const key = `${row.accountId}:${day}:${row.agent}:${row.model}`;
      const group = groups.get(key) ?? emptyAccountGroup({ row, day });
      addToAccountGroup({ group, row });
      groups.set(key, group);
    }

    return [...groups.values()];
  }

  /** Fact stamps are a ClickHouse-side projection; this tier holds none. */
  async findSessionsByStampedBranch(): Promise<{ tenantId: string; sessionId: string }[]> {
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
    aiUnits: 0,
  };
}

function emptyAccountGroup({
  row,
  day,
}: {
  row: CodingAgentSessionEventRecord;
  day: string;
}): AccountUsageGroupRow {
  return {
    accountId: row.accountId,
    day,
    agent: row.agent,
    model: row.model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    rateLimitEvents: 0,
    name: null,
    source: null,
    reading: null,
  };
}

/** Rows arrive oldest first, so each later value replaces the one before it. */
function addToAccountGroup({
  group,
  row,
}: {
  group: AccountUsageGroupRow;
  row: CodingAgentSessionEventRecord;
}): void {
  if (row.eventKind === "model_call") {
    group.inputTokens += row.inputTokens;
    group.outputTokens += row.outputTokens;
    group.cacheReadTokens += row.cacheReadTokens;
    group.cacheWriteTokens += row.cacheCreationTokens;
    group.costUsd += row.costUsd;
  } else {
    group.rateLimitEvents += 1;
  }
  if (row.accountName !== "") group.name = { value: row.accountName, atMs: row.timeUnixMs };
  if (row.accountSource !== "") group.source = { value: row.accountSource, atMs: row.timeUnixMs };
  const hasReading =
    row.accountUsagePercent !== null ||
    row.accountUsageResetsAtMs !== null ||
    row.accountLimitedUntilMs !== null;
  const atMs = row.accountUsageReadAtMs ?? row.timeUnixMs;
  if (hasReading && (group.reading === null || atMs >= group.reading.atMs)) {
    group.reading = {
      percent: row.accountUsagePercent,
      window: row.accountUsageWindow !== "" ? row.accountUsageWindow : null,
      resetsAtMs: row.accountUsageResetsAtMs,
      readAtMs: row.accountUsageReadAtMs,
      limitedUntilMs: row.accountLimitedUntilMs,
      atMs,
    };
  }
}

function asEvent(record: CodingAgentSessionEventRecord): CodingAgentSessionEvent {
  const {
    tenantId: _tenantId,
    aiUnits: _aiUnits,
    accountId: _accountId,
    accountName: _accountName,
    accountSource: _accountSource,
    accountUsagePercent: _accountUsagePercent,
    accountUsageWindow: _accountUsageWindow,
    accountUsageResetsAtMs: _accountUsageResetsAtMs,
    accountUsageReadAtMs: _accountUsageReadAtMs,
    accountLimitedUntilMs: _accountLimitedUntilMs,
    ...event
  } = record;
  return event;
}

function isAfter(record: CodingAgentSessionEventRecord, cursor: CodingAgentSessionCursor): boolean {
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
