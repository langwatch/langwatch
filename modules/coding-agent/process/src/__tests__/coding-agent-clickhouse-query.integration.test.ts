import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ClickHouseCodingAgentRepositories } from "../repositories/clickhouse/clickhouse.coding-agent.repositories.ts";
import { CodingAgentProjectionPersistenceService } from "../services/coding-agent-projection-persistence.service.ts";
import { CodingAgentFeatureService } from "../services/coding-agent.service.ts";
import {
  TEST_NOW_MS,
  TestBillingPolicy,
  TestClickHouseEndpoint,
  TestClock,
  TestGithubService,
  createTestProjects,
  session,
  sessionEventRecord,
} from "./fixtures/coding-agent.fixture.ts";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function runtime() {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  const repositories = ClickHouseCodingAgentRepositories.create({
    clickhouse: endpoint.clickhouse,
    defaultRetentionDays: 30,
    clock: new TestClock(),
    telemetry: { observe: () => undefined },
  });
  return {
    endpoint,
    projections: CodingAgentProjectionPersistenceService.create(repositories),
    service: CodingAgentFeatureService.create({
      ...repositories,
      github: new TestGithubService(),
      projects: createTestProjects(),
      billing: new TestBillingPolicy(),
      clock: new TestClock(),
    }),
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

    const found = await service.findBySessionId({
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

describe("Coding Agent session list and helper threads", () => {
  type Runtime = Awaited<ReturnType<typeof runtime>>;
  const window = { fromMs: TEST_NOW_MS - 3_600_000, toMs: TEST_NOW_MS };

  /** The record the session projection writes for a row, as the list read would return it. */
  async function storedRecord(harness: Runtime, row: Parameters<typeof session>[0]) {
    const written = harness.endpoint.requests.length;
    await harness.projections.storeSession({
      row: session(row),
      retentionDays: 14,
      appliedEventIds: [],
    });
    const request = harness.endpoint.requests[written];
    if (request === undefined) throw new Error("session projection did not write");
    return z.record(z.string(), z.unknown()).parse(JSON.parse(request.body));
  }

  async function list(harness: Runtime, records: Record<string, unknown>[], limit = 50) {
    const before = harness.endpoint.requests.length;
    harness.endpoint.queryRows.push(records);
    const rows = await harness.service.listRecent({ projectId: "project-1", ...window, limit });
    const request = harness.endpoint.requests[before];
    return { rows, sql: request?.body ?? "" };
  }

  /** @scenario "An auxiliary session is not listed" */
  it("leaves a helper thread's session out of the list and keeps the user's own", async () => {
    const harness = await runtime();
    const codex = await storedRecord(harness, { sessionId: "codex-1", agent: "codex" });
    const helper = await storedRecord(harness, {
      sessionId: "helper-1",
      agent: "codex",
      auxiliary: true,
    });

    const { rows } = await list(harness, [helper, codex]);

    expect(rows.map((row) => row.sessionId)).toEqual(["codex-1"]);
  });

  /** @scenario "A second session started seconds later is listed on its own" */
  it("lists two unmarked sessions started seconds apart", async () => {
    const harness = await runtime();
    const first = await storedRecord(harness, {
      sessionId: "codex-1",
      agent: "codex",
      startedAtMs: TEST_NOW_MS - 20_000,
    });
    const second = await storedRecord(harness, {
      sessionId: "codex-2",
      agent: "codex",
      startedAtMs: TEST_NOW_MS - 10_000,
    });

    const { rows } = await list(harness, [second, first]);

    expect(rows.map((row) => row.sessionId).toSorted()).toEqual(["codex-1", "codex-2"]);
  });

  describe("when the list is read", () => {
    /**
     * @scenario "A run of helper threads does not shorten the list"
     * @scenario "A session marked auxiliary after it was first stored drops out of the list"
     */
    it("drops a marked session inside the dedup group, so it costs no page slot", async () => {
      const harness = await runtime();

      const { sql } = await list(harness, []);

      const dedup = sql.split("SELECT TenantId, SessionId, max(UpdatedAt)")[1] ?? "";
      expect(dedup).toContain("HAVING max(toUInt8(Auxiliary)) = 0");
      expect(dedup.indexOf("GROUP BY TenantId, SessionId")).toBeLessThan(
        dedup.indexOf("HAVING max(toUInt8(Auxiliary)) = 0"),
      );
    });
  });
});
