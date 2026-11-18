import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ClickHouseCodingAgentRepositories } from "../repositories/clickhouse/clickhouse.coding-agent.repositories.ts";
import { CodingAgentProjectionPersistenceService } from "../services/coding-agent-projection-persistence.service.ts";
import { CodingAgentFeatureService } from "../services/coding-agent.service.ts";
import { ModelCatalogCostEstimatorService } from "../services/model-catalog-cost-estimator.service.ts";
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

type SentRequest = TestClickHouseEndpoint["requests"][number];

/** The values `request` binds to the placeholders `pattern` captures in `within` (its SQL). */
function bound({
  request,
  pattern,
  within = request?.body ?? "",
}: {
  request: SentRequest | undefined;
  pattern: RegExp;
  within?: string;
}): (string | null)[] {
  const names = pattern.exec(within)?.slice(1) ?? [];
  const params = new URL(request?.url ?? "", "http://endpoint").searchParams;
  return names.map((name) => params.get(`param_${name}`));
}

/** A list read's `latest` election (the dedup group) and the page read over it. */
function electionAndPage(sql: string): { election: string; page: string } {
  const [, election = "", page = ""] = /^WITH latest AS \((.*?)\) SELECT (.*)$/s.exec(sql) ?? [];
  return { election, page };
}

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
      modelProviders: ModelCatalogCostEstimatorService.create(),
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
    const request = endpoint.requests[0];
    expect(request?.body).toContain(
      "AND TimeUnixMs >= fromUnixTimestamp64Milli({idBound_fromMs:Int64}) " +
        "AND TimeUnixMs <= fromUnixTimestamp64Milli({idBound_toMs:Int64})",
    );
    expect(request?.url).toContain("param_idBound_fromMs=100");
    expect(request?.url).toContain("param_idBound_toMs=200");
    expect(bound({ request, pattern: /EventKind IN \(\{(\w+):Array\(String\)\}\)/ })).toEqual([
      "['model_call']",
    ]);
    expect(
      bound({
        request,
        pattern:
          /tuple\(TimeUnixMs, RecordId\) > tuple\(fromUnixTimestamp64Milli\(\{(\w+):Int64\}\), \{(\w+):String\}\)/,
      }),
    ).toEqual(["150", "record-1"]);
    expect(request?.body).toMatch(
      /ORDER BY TimeUnixMs ASC, RecordId ASC, UpdatedAt DESC LIMIT 1 BY TimeUnixMs, RecordId LIMIT 25\s/,
    );
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
    const { election, page } = electionAndPage(request?.body ?? "");
    expect(election).toContain("SELECT tuple(TenantId, SessionId, max(UpdatedAt))");
    expect(election).not.toContain("StartedAt");
    expect(election).not.toContain("UserId");
    expect(bound({ request, within: page, pattern: /UserId = \{(\w+):String\}/ })).toEqual([
      "user-1",
    ]);
    expect(
      bound({
        request,
        within: page,
        pattern:
          /StartedAt >= fromUnixTimestamp64Milli\(\{(\w+):Int64\}\) AND StartedAt <= fromUnixTimestamp64Milli\(\{(\w+):Int64\}\)/,
      }),
    ).toEqual([String(TEST_NOW_MS - 1_000), String(TEST_NOW_MS)]);
    expect(page).toMatch(/ORDER BY StartedAt DESC LIMIT 50\s/);
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
    return { rows, request: harness.endpoint.requests[before] };
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

      const { request } = await list(harness, []);

      const { election } = electionAndPage(request?.body ?? "");
      expect(
        bound({
          request,
          within: election,
          pattern:
            /GROUP BY TenantId, SessionId HAVING max\(toUInt8\(Auxiliary\)\) = \{(\w+):UInt8\}/,
        }),
      ).toEqual(["0"]);
    });
  });
});
