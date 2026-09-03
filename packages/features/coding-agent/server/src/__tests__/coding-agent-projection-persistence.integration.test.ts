import { afterEach, describe, expect, it } from "vitest";
import { CodingAgentProjectionPersistenceAdapter } from "@langwatch/coding-agent-server";
import { z } from "zod";
import {
  TestClickHouseEndpoint,
  TestClock,
  session,
  sessionEventRecord,
} from "../repositories/__tests__/fixtures/coding-agent.fixture";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function createPersistence() {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  return {
    endpoint,
    persistence: CodingAgentProjectionPersistenceAdapter.create({
      clickHouse: endpoint,
      retention: { defaultTraceRetentionDays: 30 },
      clock: new TestClock(),
    }),
  };
}

describe("Coding Agent projection persistence runtime adapter", () => {
  /** @scenario "projection writes use Coding Agent persistence" */
  it("persists the complete session row, retention, and durable watermark through the package runtime adapter", async () => {
    const { endpoint, persistence } = await createPersistence();

    await persistence.storeSession({
      row: session({ sessionId: "session-a", inputTokens: 123 }),
      retentionDays: 14,
      appliedEventIds: ["event-a", "event-b"],
    });

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.url).toContain("coding_agent_sessions");
    expect(endpoint.requests[0]?.body).toContain('"SessionId":"session-a"');
    expect(endpoint.requests[0]?.body).toContain('"InputTokens":"123"');
    expect(endpoint.requests[0]?.body).toContain('"AppliedEventIds":["event-a","event-b"]');
    expect(endpoint.requests[0]?.body).toContain('"_retention_days":14');
  });

  it("writes projection batches once and preserves each row's own retention and watermark", async () => {
    const { endpoint, persistence } = await createPersistence();

    await persistence.storeSessionBatch([
      { row: session({ sessionId: "first" }), retentionDays: 7, appliedEventIds: ["a"] },
      {
        row: session({ sessionId: "second" }),
        retentionDays: 30,
        appliedEventIds: ["b", "c"],
      },
    ]);

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.body).toContain('"SessionId":"first"');
    expect(endpoint.requests[0]?.body).toContain('"SessionId":"second"');
    expect(endpoint.requests[0]?.body).toContain('"_retention_days":7');
    expect(endpoint.requests[0]?.body).toContain('"_retention_days":30');
  });

  it("strictly advances session replacement versions even when its injected clock does not", async () => {
    const { endpoint, persistence } = await createPersistence();
    const row = session({ sessionId: "versioned", updatedAt: 0 });

    await persistence.storeSession({ row, retentionDays: 14, appliedEventIds: [] });
    await persistence.storeSession({ row, retentionDays: 14, appliedEventIds: [] });

    const stamps = endpoint.requests.map(
      (request) => z.object({ UpdatedAt: z.string() }).parse(JSON.parse(request.body)).UpdatedAt,
    );
    expect(Date.parse(stamps[1] ?? "")).toBeGreaterThan(Date.parse(stamps[0] ?? ""));
  });

  /** @scenario "projection writes use Coding Agent persistence" */
  it("routes each append projection to its concrete table with the supplied trace retention", async () => {
    const { endpoint, persistence } = await createPersistence();

    await persistence.appendTraceSessions(
      [
        {
          tenantId: "project-1",
          traceId: "trace-a",
          sessionId: "session-a",
          occurredAtMs: 1,
        },
      ],
      11,
    );
    await persistence.appendMetricSeries(
      [
        {
          tenantId: "project-1",
          sessionId: "session-a",
          seriesId: "series-a",
          metricName: "token.usage",
          metricUnit: "tokens",
          agent: "claude_code",
          attributes: { type: "input" },
          value: 3,
          dataPointCount: 1,
          asOfUnixMs: 2,
        },
      ],
      12,
    );
    await persistence.appendSessionEvents([sessionEventRecord()], 13);

    expect(endpoint.requests).toHaveLength(3);
    expect(endpoint.requests.map((request) => request.url)).toEqual([
      expect.stringContaining("coding_agent_trace_sessions"),
      expect.stringContaining("session_metric_series"),
      expect.stringContaining("coding_agent_session_events"),
    ]);
    expect(endpoint.requests.map((request) => request.body)).toEqual([
      expect.stringContaining('"_retention_days":11'),
      expect.stringContaining('"_retention_days":12'),
      expect.stringContaining('"_retention_days":13'),
    ]);
  });
});
