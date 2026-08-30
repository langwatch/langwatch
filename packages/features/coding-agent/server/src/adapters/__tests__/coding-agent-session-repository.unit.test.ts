import { afterEach, describe, expect, it } from "vitest";
import { NoopCodingAgentReadMetricsPort } from "../coding-agent-read-metrics.adapter";
import {
  TestClickHouseEndpoint,
  TestClock,
  session,
} from "../../repositories/__tests__/fixtures/coding-agent.fixture";
import { CodingAgentSessionClickHouseRepository } from "../../repositories/coding-agent-session/clickhouse.repository";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function createRepository() {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  return {
    endpoint,
    repository: CodingAgentSessionClickHouseRepository.create({
      clickHouse: endpoint,
      defaultTraceRetentionDays: 30,
      metrics: NoopCodingAgentReadMetricsPort.create(),
      clock: new TestClock(),
    }),
  };
}

describe("Coding Agent session ClickHouse repository", () => {
  it("writes the complete session row, retention, and durable watermark", async () => {
    const { endpoint, repository } = await createRepository();

    await repository.upsert(
      session({
        sessionId: "session-a",
        gitBranches: ["feature", "main"],
        title: "Review the migration",
        inputTokens: 123,
      }),
      14,
      ["event-a", "event-b"],
    );

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.url).toContain("coding_agent_sessions");
    expect(endpoint.requests[0]?.body).toContain('"SessionId":"session-a"');
    expect(endpoint.requests[0]?.body).toContain('"InputTokens":"123"');
    expect(endpoint.requests[0]?.body).toContain('"AppliedEventIds":["event-a","event-b"]');
    expect(endpoint.requests[0]?.body).toContain('"_retention_days":14');
  });

  it("stamps versions strictly even when the clock and input version do not advance", async () => {
    const { endpoint, repository } = await createRepository();
    const row = session({ sessionId: "versioned", updatedAt: 0 });

    await repository.upsert(row, 14, []);
    await repository.upsert(row, 14, []);

    const first = endpoint.requests[0];
    const second = endpoint.requests[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // `!` rather than `?.`: the two assertions above are what establish these
    // are present, and TypeScript does not narrow through `expect`.
    const firstUpdated = /"UpdatedAt":"([^"]+)"/.exec(first!.body)?.[1];
    const secondUpdated = /"UpdatedAt":"([^"]+)"/.exec(second!.body)?.[1];
    expect(firstUpdated).toBeDefined();
    expect(secondUpdated).toBeDefined();
    expect(Date.parse(secondUpdated ?? "")).toBeGreaterThan(Date.parse(firstUpdated ?? ""));
  });

  it("decodes ClickHouse DateTime64 values as UTC and preserves the zero checkpoint", async () => {
    const { endpoint, repository } = await createRepository();
    endpoint.queryRows.push([
      {
        TenantId: "project-1",
        SessionId: "session-a",
        Version: "2026-07-21",
        StartedAt: "2026-07-24 12:00:00.000",
        CreatedAt: "2026-07-24 12:00:00.000",
        UpdatedAt: "2026-07-24 12:00:02.500",
        LastEventOccurredAt: "1970-01-01 00:00:00.000",
      },
    ]);

    const found = await repository.tryFindBySessionIdWithApplied({
      tenantId: "project-1",
      sessionId: "session-a",
    });

    expect(found?.row.startedAtMs).toBe(Date.parse("2026-07-24T12:00:00Z"));
    expect(found?.row.updatedAt).toBe(Date.parse("2026-07-24T12:00:02.500Z"));
    expect(found?.row.lastEventOccurredAt).toBe(0);
  });

  it("keeps list range and user filters outside latest-version deduplication", async () => {
    const { endpoint, repository } = await createRepository();
    endpoint.queryRows.push([]);

    await repository.findManyRecent({
      tenantId: "project-1",
      userId: "user-1",
      fromMs: 100,
      toMs: 200,
      limit: 25,
    });

    const request = endpoint.requests[0];
    expect(request?.body).toContain("StartedAt BETWEEN");
    expect(request?.body).toContain("UserId =");
    expect(request?.body).toContain("SELECT TenantId, SessionId, max(UpdatedAt)");
    const dedup = request?.body.split("SELECT TenantId, SessionId, max(UpdatedAt)")[1] ?? "";
    expect(dedup).not.toContain("StartedAt BETWEEN");
    expect(dedup).not.toContain("UserId =");
  });
});
