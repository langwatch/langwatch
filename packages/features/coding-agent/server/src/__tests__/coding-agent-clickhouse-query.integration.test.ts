import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentRuntime,
} from "@langwatch/coding-agent-server";
import {
  TEST_NOW_MS,
  TestBillingPolicy,
  TestClickHouseEndpoint,
  TestClock,
  TestGithubService,
  TestProjectService,
  session,
  sessionEventRecord,
} from "../repositories/__tests__/fixtures/coding-agent.fixture";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function runtime() {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  const projections = CodingAgentProjectionPersistenceAdapter.create({
    clickHouse: endpoint,
    retention: { defaultTraceRetentionDays: 30 },
    clock: new TestClock(),
  });
  return {
    endpoint,
    projections,
    service: CodingAgentRuntime.create({
      projections,
      github: new TestGithubService(),
      projects: new TestProjectService(),
      billing: new TestBillingPolicy(),
    }).service,
  };
}

describe("Coding Agent ClickHouse query contract", () => {
  /**
   * @scenario re-delivery does not duplicate a row
   * @scenario a session's events list in time order with stable pagination
   */
  it("keeps event reads ordered, deduplicated, keyset-paginated, and bounded by the caller window", async () => {
    const { endpoint, service } = await runtime();

    await service.getSessionEvents({
      projectId: "project-1",
      sessionId: "session-1",
      occurredAt: { fromMs: 100, toMs: 200 },
      kinds: ["model_call"],
      cursor: { timeUnixMs: 150, recordId: "record-1" },
      limit: 25,
    });

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.body).toContain("TimeUnixMs BETWEEN");
    expect(endpoint.requests[0]?.body).toContain("EventKind IN");
    expect(endpoint.requests[0]?.body).toContain("(TimeUnixMs, RecordId) >");
    expect(endpoint.requests[0]?.body).toContain(
      "ORDER BY TimeUnixMs ASC, RecordId ASC, UpdatedAt DESC",
    );
    expect(endpoint.requests[0]?.body).toContain("LIMIT 1 BY TimeUnixMs, RecordId");
    expect(endpoint.requests[0]?.body).toContain("LIMIT {limit:UInt32}");
    expect(endpoint.requests[0]?.url).toContain("param_fromMs=100");
    expect(endpoint.requests[0]?.url).toContain("param_toMs=200");
    expect(endpoint.requests[0]?.url).toContain("param_cursorTimeMs=150");
  });

  it("keeps the session list range and user filter outside its unwindowed latest-version dedup", async () => {
    const { endpoint, service } = await runtime();

    await service.listRecent({
      projectId: "project-1",
      userId: "user-1",
      fromMs: TEST_NOW_MS - 1_000,
      toMs: TEST_NOW_MS,
      limit: 25,
    });

    const request = endpoint.requests[0];
    expect(request?.body).toContain("AND UserId = {userId:String}");
    expect(request?.body).toContain("StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64})");
    expect(request?.body).toContain("SELECT TenantId, SessionId, max(UpdatedAt)");
    const dedup = request?.body.split("SELECT TenantId, SessionId, max(UpdatedAt)")[1] ?? "";
    expect(dedup).not.toContain("StartedAt BETWEEN");
    expect(dedup).not.toContain("UserId =");
    expect(request?.url).toContain("param_limit=50");
  });

  it("round-trips a session through concrete package persistence and returns the durable row unchanged", async () => {
    const { endpoint, projections, service } = await runtime();
    const row = {
      sessionId: "round-trip",
      title: "Review the migration",
      gitBranches: ["feature", "main"],
      inputTokens: 321,
      costUsd: 4.5,
    };

    await projections.storeSession({
      row: session(row),
      retentionDays: 14,
      appliedEventIds: ["delivery-1"],
    });
    const request = endpoint.requests[0];
    if (request === undefined) throw new Error("session projection did not write");
    endpoint.queryRows.push([z.record(z.string(), z.unknown()).parse(JSON.parse(request.body))]);

    const found = await service.tryGetBySessionId({
      projectId: "project-1",
      sessionId: "round-trip",
    });

    expect(found).toMatchObject(row);
  });

  it("round-trips event facts in time order and carries a cursor only at a complete page", async () => {
    const { endpoint, projections, service } = await runtime();
    await projections.appendSessionEvents(
      [
        sessionEventRecord({
          sessionId: "session-events",
          recordId: "record-1",
          timeUnixMs: 123,
        }),
      ],
      14,
    );
    const request = endpoint.requests[0];
    if (request === undefined) throw new Error("event projection did not write");
    const stored = z.record(z.string(), z.unknown()).parse(JSON.parse(request.body));
    endpoint.queryRows.push([{ ...stored, TimeMs: "123" }]);

    const page = await service.getSessionEvents({
      projectId: "project-1",
      sessionId: "session-events",
      occurredAt: { fromMs: 0, toMs: 1_000 },
      limit: 1,
    });

    expect(page.events).toEqual([
      expect.objectContaining({
        sessionId: "session-events",
        recordId: "record-1",
        timeUnixMs: 123,
      }),
    ]);
    expect(page.nextCursor).toEqual({ timeUnixMs: 123, recordId: "record-1" });
  });
});
