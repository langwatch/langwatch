import { SHARED_CLICKHOUSE_TARGET } from "@langwatch/clickhouse-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  TestClickHouseEndpoint,
  TestClock,
  aggregateProof,
  session,
} from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import {
  type CodingAgentReadMetrics,
  type CodingAgentSessionListReadOutcome,
  type SessionIdIndexRead,
  SessionIdIndexNotReadyError,
} from "../../coding-agent-session.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

const DAY_MS = 86_400_000;
const SPAN_FROM_MS = Date.parse("2026-08-03T10:00:00Z");
const SPAN_TO_MS = Date.parse("2026-08-05T10:00:00Z");

/** Counts the reads that found the session id index not ready, and the list outcomes observed. */
class NotReadyCounter implements CodingAgentReadMetrics {
  readonly notReady: { read: SessionIdIndexRead; target: string }[] = [];
  readonly outcomes: CodingAgentSessionListReadOutcome[] = [];

  observeSessionListRead({ outcome }: { outcome: CodingAgentSessionListReadOutcome }): void {
    this.outcomes.push(outcome);
  }

  countSessionIdIndexNotReady({
    read,
    target,
  }: {
    read: SessionIdIndexRead;
    target: string;
  }): void {
    this.notReady.push({ read, target });
  }
}

async function createRepository({
  idIndexReady = false,
  metrics = NoopCodingAgentReadMetricsService.create(),
}: { idIndexReady?: boolean; metrics?: CodingAgentReadMetrics } = {}) {
  const endpoint = await TestClickHouseEndpoint.create({ idIndexReady });
  endpoints.push(endpoint);
  return {
    endpoint,
    repository: CodingAgentSessionClickHouseRepository.create({
      clickhouse: endpoint.clickhouse,
      defaultTraceRetentionDays: 30,
      metrics,
      clock: new TestClock(),
    }),
  };
}

/** The id index's answer for the sessions a read reaches: how many, over the test's span. */
const spanRow = (n: number) => [{ n, fromMs: SPAN_FROM_MS, toMs: SPAN_TO_MS }];

const paramOf = (request: { url: string } | undefined, name: string) =>
  new URL(request?.url ?? "", "http://x").searchParams.get(`param_${name}`);

const dedupScopeOf = (body: string | undefined) =>
  body?.split("SELECT TenantId, SessionId, max(UpdatedAt)")[1] ?? "";

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

    const found = await repository.findBySessionIdWithApplied({
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

  /**
   * @see specs/governance/aggregate-project.feature
   * @scenario "A sessions read through the proof names no tenant of its own"
   */
  it("reads an aggregate's page under the proof's tenants and StartedAt windows", async () => {
    const { endpoint, repository } = await createRepository();
    endpoint.queryRows.push([]);

    await repository.findManyRecentFenced({
      authorization: aggregateProof({
        projectId: "aggregate",
        members: [{ projectId: "member-a", from: 1_000 }],
      }),
      fromMs: 100,
      toMs: 200,
      limit: 25,
    });

    const request = endpoint.requests[0];
    expect(request?.body).not.toContain("{tenantId:String}");
    expect(request?.body).toContain("StartedAt BETWEEN");
    expect(request?.body).toContain("TenantId IN (");
    expect(request?.body).toMatch(/transform\(TenantId.*StartedAt/s);
    const dedup = request?.body.split("SELECT TenantId, SessionId, max(UpdatedAt)")[1] ?? "";
    expect(dedup).toContain("TenantId IN (");
    expect(dedup).not.toContain("StartedAt BETWEEN");
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
          {
            row: session({ sessionId: "batched", updatedAt: 0 }),
            retentionDays: 14,
            appliedEventIds: [],
          },
          {
            row: session({ sessionId: "batched", updatedAt: 0 }),
            retentionDays: 14,
            appliedEventIds: [],
          },
          {
            row: session({ sessionId: "batched", updatedAt: 0 }),
            retentionDays: 14,
            appliedEventIds: [],
          },
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

        const found = await repository.findBySessionIdWithApplied({
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

        const found = await repository.findBySessionIdWithApplied({
          tenantId: "tenant-1",
          sessionId: "sess-1",
        });

        expect(found?.row.lastEventOccurredAt).toBe(0);
      });
    });
  });

  describe("given the session id index is ready", () => {
    describe("when asked what other session a project holds", () => {
      const kindOf = (repository: CodingAgentSessionClickHouseRepository) =>
        repository.findOtherSessionKind({ tenantId: "project-1", excludeSessionIds: ["s-1"] });

      it("answers none from the index alone when it names no other session", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(0));

        await expect(kindOf(repository)).resolves.toBe("none");

        expect(endpoint.requests).toHaveLength(1);
        expect(endpoint.requests[0]?.body).toContain("FROM coding_agent_sessions_id_index");
        expect(endpoint.requests[0]?.body).toContain("SessionId NOT IN {excludeSessionIds");
        expect(endpoint.requests[0]?.body).not.toMatch(/FROM coding_agent_sessions\s/);
      });

      it("probes the sessions table only inside the other sessions' span, a day each side", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(2), [{ SessionId: "s-2" }]);

        await expect(kindOf(repository)).resolves.toBe("main");

        const [, probe] = endpoint.requests;
        expect(endpoint.requests).toHaveLength(2);
        expect(probe?.body).toContain(
          "StartedAt BETWEEN fromUnixTimestamp64Milli({spanFrom:Int64})",
        );
        expect(probe?.body).toContain("AND Auxiliary = 0");
        expect(paramOf(probe, "spanFrom")).toBe(String(SPAN_FROM_MS - DAY_MS));
        expect(paramOf(probe, "spanTo")).toBe(String(SPAN_TO_MS + DAY_MS));
      });

      it("answers helpers_only when only a helper row sits inside the span", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), [], [{ SessionId: "h-1" }]);

        await expect(kindOf(repository)).resolves.toBe("helpers_only");

        const [, , anyProbe] = endpoint.requests;
        expect(anyProbe?.body).toContain("{spanFrom:Int64}");
        expect(anyProbe?.body).not.toContain("Auxiliary = 0");
      });

      it("answers none when the index names sessions whose rows have expired", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), [], []);

        await expect(kindOf(repository)).resolves.toBe("none");
      });
    });

    describe("when a window of recent sessions is listed", () => {
      it("bounds the dedup scope to the span of the window's sessions", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(3), []);

        await repository.findManyRecent({
          tenantId: "project-1",
          fromMs: 100,
          toMs: 200,
          limit: 5,
        });

        const [span, list] = endpoint.requests;
        expect(span?.body).toContain("HAVING SessionToAt >= fromUnixTimestamp64Milli({overlapFrom");
        expect(span?.body).toContain("SessionFromAt <= fromUnixTimestamp64Milli({overlapTo");
        expect(paramOf(span, "overlapFrom")).toBe("100");
        expect(paramOf(span, "overlapTo")).toBe("200");
        expect(dedupScopeOf(list?.body)).toContain("{spanFrom:Int64}");
        expect(dedupScopeOf(list?.body)).not.toContain("{from:Int64}");
        expect(paramOf(list, "spanFrom")).toBe(String(SPAN_FROM_MS - DAY_MS));
      });

      it("reads no session rows when the index names no session in the window", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(0));

        await expect(
          repository.findManyRecent({ tenantId: "project-1", fromMs: 100, toMs: 200, limit: 5 }),
        ).resolves.toEqual([]);

        expect(endpoint.requests).toHaveLength(1);
      });

      it("observes no_sessions, not empty, when the index names no session", async () => {
        const metrics = new NotReadyCounter();
        const { endpoint, repository } = await createRepository({ idIndexReady: true, metrics });
        endpoint.queryRows.push(spanRow(0));

        await repository.findManyRecent({
          tenantId: "project-1",
          fromMs: 100,
          toMs: 200,
          limit: 5,
        });

        expect(metrics.outcomes).toEqual(["no_sessions"]);
        expect(endpoint.requests).toHaveLength(1);
      });

      it("bounds a fenced page's dedup scope from the index under the fence's tenants", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), []);

        await repository.findManyRecentFenced({
          authorization: aggregateProof({
            projectId: "aggregate",
            members: [{ projectId: "member-a", from: 1_000 }],
          }),
          fromMs: 100,
          toMs: 200,
          limit: 25,
        });

        const [span, page] = endpoint.requests;
        expect(span?.body).toContain("TenantId IN ({tenantIds:Array(String)})");
        expect(paramOf(span, "tenantIds")).toBe("['aggregate','member-a']");
        expect(dedupScopeOf(page?.body)).toContain("{spanFrom:Int64}");
      });
    });

    describe("when a repository branch's sessions are listed", () => {
      it("bounds the dedup scope to the span of the sessions since the caller's time", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), []);

        await repository.findByRepositoryBranch({
          tenantIds: ["project-1", "project-2"],
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "app",
          branches: ["main"],
          startedAtFromMs: 100,
        });

        const [span, list] = endpoint.requests;
        expect(span?.body).toContain("HAVING SessionToAt >=");
        expect(span?.body).not.toContain("SessionFromAt <=");
        expect(dedupScopeOf(list?.body)).toContain("{spanFrom:Int64}");
      });

      it("reads no session rows when the index names no session since the caller's time", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(0));

        await expect(
          repository.findByRepositoryBranch({
            tenantIds: ["project-1"],
            repositoryHost: "github.com",
            repositoryOwner: "acme",
            repositoryName: "app",
            branches: ["main"],
            startedAtFromMs: 100,
          }),
        ).resolves.toEqual([]);

        expect(endpoint.requests).toHaveLength(1);
      });
    });

    describe("when sessions are fetched by id", () => {
      it("bounds the dedup scope to the index range of those ids", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), []);

        await repository.findBySessionIds({
          tenantIds: ["project-1"],
          sessionIds: ["s-1", "s-2"],
          startedAtFromMs: 100,
        });

        const [, read] = endpoint.requests;
        expect(dedupScopeOf(read?.body)).toContain("StartedAt >= fromUnixTimestamp64Milli");
        expect(dedupScopeOf(read?.body)).toContain("SessionId IN {sessionIds");
        expect(paramOf(read, "idBound_fromMs")).toBe(String(SPAN_FROM_MS - DAY_MS));
      });
    });

    describe("when one session is read inside the caller's window", () => {
      it("bounds the dedup scope by the index and the outer scan by the window", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(1), []);

        await repository.findBySessionId({
          tenantId: "project-1",
          sessionId: "s-1",
          window: { fromMs: 100, toMs: 200 },
        });

        const [, read] = endpoint.requests;
        expect(dedupScopeOf(read?.body)).toContain("StartedAt >= fromUnixTimestamp64Milli");
        expect(dedupScopeOf(read?.body)).not.toContain("{from:Int64}");
        expect(paramOf(read, "from")).toBe("100");
      });
    });

    describe("when the usage report counts a project's sessions", () => {
      it("bounds both counts to the span of the project's sessions", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(
          spanRow(2),
          [{ Total: "2", FirstMs: "0" }],
          [{ Total: "3", FirstMs: String(SPAN_FROM_MS) }],
        );

        await expect(repository.countUsage({ projectIds: ["project-1"] })).resolves.toEqual({
          sessions: 2,
          firstSessionAt: SPAN_FROM_MS,
        });

        const counts = endpoint.requests.slice(1);
        expect(counts).toHaveLength(2);
        for (const count of counts) {
          expect(count.body).toContain("StartedAt BETWEEN fromUnixTimestamp64Milli({spanFrom");
        }
      });

      it("counts nothing without reading the sessions table when the index names no session", async () => {
        const { endpoint, repository } = await createRepository({ idIndexReady: true });
        endpoint.queryRows.push(spanRow(0));

        await expect(repository.countUsage({ projectIds: ["project-1"] })).resolves.toEqual({
          sessions: 0,
        });
        expect(endpoint.requests).toHaveLength(1);
      });
    });
  });

  describe("given the session id index is not ready", () => {
    /**
     * @see modules/coding-agent/specs/coding-agent-session-stored.feature
     * @scenario "A history check fails closed while the session id index is not ready"
     */
    it("refuses the other-session check rather than scan the project's history", async () => {
      const metrics = new NotReadyCounter();
      const { endpoint, repository } = await createRepository({ metrics });

      await expect(
        repository.findOtherSessionKind({ tenantId: "project-1", excludeSessionIds: ["s-1"] }),
      ).rejects.toBeInstanceOf(SessionIdIndexNotReadyError);

      expect(endpoint.requests).toHaveLength(0);
      expect(metrics.notReady).toEqual([
        { read: "other_session_kind", target: SHARED_CLICKHOUSE_TARGET },
      ]);
    });

    it("lists recent sessions as before the index, and counts the unbounded read", async () => {
      const metrics = new NotReadyCounter();
      const { endpoint, repository } = await createRepository({ metrics });
      endpoint.queryRows.push([]);

      await repository.findManyRecent({ tenantId: "project-1", fromMs: 100, toMs: 200, limit: 5 });

      expect(endpoint.requests).toHaveLength(1);
      expect(dedupScopeOf(endpoint.requests[0]?.body)).not.toContain("{spanFrom");
      expect(endpoint.requests[0]?.body).not.toContain("_id_index");
      expect(metrics.notReady).toEqual([{ read: "recent_list", target: SHARED_CLICKHOUSE_TARGET }]);
    });

    it("lists a branch's sessions unbounded, and counts the read once", async () => {
      const metrics = new NotReadyCounter();
      const { endpoint, repository } = await createRepository({ metrics });
      endpoint.queryRows.push([]);

      await repository.findByRepositoryBranch({
        tenantIds: ["project-1"],
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "app",
        branches: ["main"],
        startedAtFromMs: 100,
      });

      expect(endpoint.requests).toHaveLength(1);
      expect(dedupScopeOf(endpoint.requests[0]?.body)).not.toContain("{spanFrom");
      expect(endpoint.requests[0]?.body).not.toContain("_id_index");
      expect(metrics.notReady).toEqual([{ read: "branch_list", target: SHARED_CLICKHOUSE_TARGET }]);
    });

    it("lists a fenced page unbounded, and counts the read once", async () => {
      const metrics = new NotReadyCounter();
      const { endpoint, repository } = await createRepository({ metrics });
      endpoint.queryRows.push([]);

      await repository.findManyRecentFenced({
        authorization: aggregateProof({
          projectId: "aggregate",
          members: [{ projectId: "member-a", from: 1_000 }],
        }),
        fromMs: 100,
        toMs: 200,
        limit: 25,
      });

      expect(endpoint.requests).toHaveLength(1);
      expect(dedupScopeOf(endpoint.requests[0]?.body)).not.toContain("{spanFrom");
      expect(endpoint.requests[0]?.body).not.toContain("_id_index");
      expect(metrics.notReady).toEqual([
        { read: "recent_list_fenced", target: SHARED_CLICKHOUSE_TARGET },
      ]);
    });

    it("counts usage unbounded, and counts the read once", async () => {
      const metrics = new NotReadyCounter();
      const { endpoint, repository } = await createRepository({ metrics });
      endpoint.queryRows.push([{ Total: "0", FirstMs: "0" }], [{ Total: "0", FirstMs: "0" }]);

      await repository.countUsage({ projectIds: ["project-1"] });

      expect(endpoint.requests).toHaveLength(2);
      for (const request of endpoint.requests) {
        expect(request.body).not.toContain("{spanFrom");
        expect(request.body).not.toContain("_id_index");
      }
      expect(metrics.notReady).toEqual([{ read: "usage_count", target: SHARED_CLICKHOUSE_TARGET }]);
    });
  });
});
