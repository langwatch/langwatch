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

  describe("given two versions of one session inside the same millisecond", () => {
    describe("when both are written through the repository", () => {
      it("stamps strictly increasing versions so the latest always wins", async () => {
        const { endpoint, repository } = await createRepository();
        const row = session({ sessionId: "versioned", updatedAt: 0 });

        await repository.upsert(row, 14, []);
        await repository.upsert(row, 14, []);

        const first = endpoint.requests[0];
        const second = endpoint.requests[1];
        const firstUpdated = /"UpdatedAt":"([^"]+)"/.exec(first?.body ?? "")?.[1];
        const secondUpdated = /"UpdatedAt":"([^"]+)"/.exec(second?.body ?? "")?.[1];
        expect(Date.parse(secondUpdated ?? "")).toBeGreaterThan(Date.parse(firstUpdated ?? ""));
      });
    });
  });

  describe("given a row threading its superseded version's timestamp", () => {
    describe("when it is written while this writer's clock lags that prior", () => {
      it("stamps past the prior version", async () => {
        const { endpoint, repository } = await createRepository();
        const priorMs = Date.now() + 60_000;
        const row = session({ sessionId: "versioned", updatedAt: priorMs });

        await repository.upsert(row, 14, []);

        const stamped = /"UpdatedAt":"([^"]+)"/.exec(endpoint.requests[0]?.body ?? "")?.[1];
        expect(Date.parse(stamped ?? "")).toBeGreaterThan(priorMs);
      });
    });
  });

  describe("given a batch of versions for one session", () => {
    describe("when the batch is written in one insert", () => {
      it("stamps each entry past the one before it", async () => {
        const { endpoint, repository } = await createRepository();

        await repository.upsertBatch([
          { row: session({ sessionId: "batched", updatedAt: 0 }), retentionDays: 14, appliedEventIds: [] },
          { row: session({ sessionId: "batched", updatedAt: 0 }), retentionDays: 14, appliedEventIds: [] },
          { row: session({ sessionId: "batched", updatedAt: 0 }), retentionDays: 14, appliedEventIds: [] },
        ]);

        const stamps = (endpoint.requests[0]?.body ?? "")
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => Date.parse(/"UpdatedAt":"([^"]+)"/.exec(line)?.[1] ?? ""));
        expect(stamps).toHaveLength(3);
        expect(stamps[1]).toBeGreaterThan(stamps[0]!);
        expect(stamps[2]).toBeGreaterThan(stamps[1]!);
      });
    });
  });

  describe("given a row whose columns carry no timezone suffix", () => {
    describe("when it is read back on a host that is not on UTC", () => {
      it("decodes them as UTC rather than the host's local time", async () => {
        const { endpoint, repository } = await createRepository();
        endpoint.queryRows.push([
          {
            TenantId: "tenant-1",
            SessionId: "sess-1",
            Version: "2026-07-21",
            StartedAt: "2026-07-24 12:00:00.000",
            CreatedAt: "2026-07-24 12:00:00.000",
            UpdatedAt: "2026-07-24 12:00:02.500",
            LastEventOccurredAt: "2026-07-24 12:00:01.250",
          },
        ]);

        const found = await repository.tryFindBySessionIdWithApplied({
          tenantId: "tenant-1",
          sessionId: "sess-1",
        });

        expect(found?.row.startedAtMs).toBe(Date.parse("2026-07-24T12:00:00Z"));
        expect(found?.row.updatedAt).toBe(Date.parse("2026-07-24T12:00:02.500Z"));
        expect(found?.row.lastEventOccurredAt).toBe(Date.parse("2026-07-24T12:00:01.250Z"));
      });
    });
  });

  describe("given a pre-00053 row whose checkpoint is the column default", () => {
    describe("when it is read back off UTC in either direction", () => {
      it("decodes the checkpoint as 0 so the store's gate still rejects it", async () => {
        const { endpoint, repository } = await createRepository();
        endpoint.queryRows.push([
          {
            TenantId: "tenant-1",
            SessionId: "sess-1",
            Version: "2026-07-21",
            StartedAt: "2026-07-24 12:00:00.000",
            CreatedAt: "2026-07-24 12:00:00.000",
            UpdatedAt: "2026-07-24 12:00:02.500",
            LastEventOccurredAt: "1970-01-01 00:00:00.000",
          },
        ]);

        const found = await repository.tryFindBySessionIdWithApplied({
          tenantId: "tenant-1",
          sessionId: "sess-1",
        });

        expect(found?.row.lastEventOccurredAt).toBe(0);
      });
    });
  });
});
