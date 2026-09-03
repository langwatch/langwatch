import { afterEach, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { CodingAgentClickHousePort } from "../coding-agent-clickhouse.port";
import { CodingAgentSessionEventsClickHouseRepository } from "../../repositories/coding-agent-session-event/clickhouse.repository";
import { TestClickHouseEndpoint } from "../../repositories/__tests__/fixtures/coding-agent.fixture";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

class RoutedClickHouse extends CodingAgentClickHousePort {
  constructor(private readonly byTenant: Map<string, TestClickHouseEndpoint>) {
    super();
  }

  async resolve(tenantId: string): Promise<ClickHouseClient> {
    const endpoint = this.byTenant.get(tenantId);
    if (endpoint === undefined) throw new Error(`no ClickHouse endpoint for ${tenantId}`);
    return endpoint.resolve();
  }
}

function modelTotal(tenantId: string, sessionId: string, costUsd: number) {
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    Model: "claude-fable-5",
    InputTokens: "1",
    OutputTokens: "1",
    CacheReadTokens: "1",
    CacheCreationTokens: "1",
    CostUsd: costUsd,
  };
}

describe("Coding Agent session-event ClickHouse repository", () => {
  it("routes each tenant group to its endpoint and combines the model totals", async () => {
    const first = await TestClickHouseEndpoint.create();
    const second = await TestClickHouseEndpoint.create();
    endpoints.push(first, second);
    first.queryRows.push([modelTotal("tenant-a", "session-a", 3)]);
    second.queryRows.push([modelTotal("tenant-b", "session-b", 4)]);
    const repository = new CodingAgentSessionEventsClickHouseRepository(
      new RoutedClickHouse(
        new Map([
          ["tenant-a", first],
          ["tenant-b", second],
        ]),
      ),
      30,
    );

    const totals = await repository.sumTokensByModelPerSession({
      tenantIds: ["tenant-a", "tenant-b"],
      sessionIds: ["session-a", "session-b"],
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });

    expect(first.requests[0]?.url).toContain("param_tenantIds=%5B%27tenant-a%27%5D");
    expect(second.requests[0]?.url).toContain("param_tenantIds=%5B%27tenant-b%27%5D");
    expect(totals.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
    expect(totals.map((row) => row.costUsd)).toEqual([3, 4]);
  });

  it("uses one query when all tenants share an endpoint", async () => {
    const endpoint = await TestClickHouseEndpoint.create();
    endpoints.push(endpoint);
    endpoint.queryRows.push([]);
    const repository = new CodingAgentSessionEventsClickHouseRepository(
      new RoutedClickHouse(
        new Map([
          ["tenant-a", endpoint],
          ["tenant-b", endpoint],
        ]),
      ),
      30,
    );

    await repository.sumTokensByModelPerSession({
      tenantIds: ["tenant-a", "tenant-b"],
      sessionIds: ["session-a"],
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.url).toContain(
      "param_tenantIds=%5B%27tenant-a%27%2C%27tenant-b%27%5D",
    );
  });
});

/**
 * A stored row as ClickHouse hands it back over JSONEachRow: every numeric
 * column arrives as a STRING. That is the whole reason `findBySessionId` maps
 * rather than casts, and it is what the cursor depends on — a `timeUnixMs`
 * left as text would make the next page's `(TimeUnixMs, RecordId) > (…)`
 * comparison a string comparison, which orders "1000" before "9".
 */
function storedRow(over: Record<string, unknown> = {}) {
  return {
    SessionId: "session-a",
    TimeMs: "1782000000000",
    RecordId: "record-1",
    EventKind: "assistant_message",
    Agent: "claude-code",
    SessionKeySource: "explicit",
    TraceId: "trace-1",
    SpanId: "span-1",
    PromptId: "prompt-1",
    QuerySource: "cli",
    AgentType: "coding",
    EventSequence: "7",
    RequestId: "request-1",
    Model: "claude-fable-5",
    InputTokens: "11",
    OutputTokens: "22",
    CacheReadTokens: "33",
    CacheCreationTokens: "44",
    CostUsd: "0.55",
    DurationMs: "660",
    TtftMs: "77",
    Attempt: "1",
    Speed: "fast",
    StopReason: "end_turn",
    PreTokens: "88",
    PostTokens: "99",
    CompactionTrigger: "",
    PrecomputeReuse: "",
    ...over,
  };
}

async function repositoryReading(rows: Record<string, unknown>[]) {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  endpoint.queryRows.push(rows);

  return new CodingAgentSessionEventsClickHouseRepository(
    new RoutedClickHouse(new Map([["tenant-a", endpoint]])),
    30,
  );
}

const page = async (rows: Record<string, unknown>[], limit = 10) =>
  (await repositoryReading(rows)).findBySessionId({
    tenantId: "tenant-a",
    sessionId: "session-a",
    limit,
  });

describe("given a session's stored events are read back", () => {
  it("turns every numeric column into a number, not the string it arrived as", async () => {
    const { events } = await page([storedRow()]);

    expect(events[0]).toMatchObject({
      timeUnixMs: 1782000000000,
      eventSequence: 7,
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
      costUsd: 0.55,
      durationMs: 660,
      ttftMs: 77,
      attempt: 1,
      preTokens: 88,
      postTokens: 99,
    });
  });

  it("keeps the identifying columns as the text they are", async () => {
    const { events } = await page([storedRow()]);

    expect(events[0]).toMatchObject({
      sessionId: "session-a",
      recordId: "record-1",
      eventKind: "assistant_message",
      model: "claude-fable-5",
    });
  });

  describe("when the page came back full", () => {
    it("offers a cursor built from the last row, so the next page resumes after it", async () => {
      const { nextCursor } = await page(
        [
          storedRow({ RecordId: "record-1", TimeMs: "1782000000000" }),
          storedRow({ RecordId: "record-2", TimeMs: "1782000009000" }),
        ],
        2,
      );

      expect(nextCursor).toEqual({ timeUnixMs: 1782000009000, recordId: "record-2" });
    });
  });

  describe("when the page came back short", () => {
    it("offers no cursor, because there is nothing after it", async () => {
      const { nextCursor } = await page([storedRow()], 10);

      expect(nextCursor).toBeNull();
    });
  });

  describe("given no events at all", () => {
    it("answers with an empty page rather than a cursor to nowhere", async () => {
      const { events, nextCursor } = await page([], 10);

      expect(events).toEqual([]);
      expect(nextCursor).toBeNull();
    });
  });
});
