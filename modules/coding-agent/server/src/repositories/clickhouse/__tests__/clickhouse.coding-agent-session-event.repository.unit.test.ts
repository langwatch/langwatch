import { afterEach, describe, expect, it } from "vitest";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import { TestClickHouseEndpoint } from "../../../__tests__/fixtures/coding-agent.fixture.ts";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

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
  it("sends one statement carrying every tenant of the organization, and combines the model totals", async () => {
    const endpoint = await TestClickHouseEndpoint.create();
    endpoints.push(endpoint);
    endpoint.queryRows.push([
      modelTotal("tenant-a", "session-a", 3),
      modelTotal("tenant-b", "session-b", 4),
    ]);
    const repository = CodingAgentSessionEventsClickHouseRepository.create({
      clickhouse: endpoint.clickhouse,
      defaultTraceRetentionDays: 30,
    });

    const totals = await repository.sumTokensByModelPerSession({
      tenantIds: ["tenant-a", "tenant-b"],
      sessionIds: ["session-a", "session-b"],
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.url).toContain(
      "param_tenantIds=%5B%27tenant-a%27%2C%27tenant-b%27%5D",
    );
    expect(totals.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
    expect(totals.map((row) => row.costUsd)).toEqual([3, 4]);
  });
});

/**
 * A stored row as ClickHouse hands it back over JSONEachRow: every numeric column arrives
 * as a STRING.
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

  return CodingAgentSessionEventsClickHouseRepository.create({
    clickhouse: endpoint.clickhouse,
    defaultTraceRetentionDays: 30,
  });
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
