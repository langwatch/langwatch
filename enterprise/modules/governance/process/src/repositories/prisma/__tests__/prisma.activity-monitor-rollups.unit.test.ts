import type {
  GovernanceSortDirection as SortDir,
  SpendOverTimeGroupBy,
  SpendSortField,
} from "@langwatch/enterprise-governance-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import type { TraceDailySpendGroup } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createActivityMonitorTestService } from "../../../__tests__/testing.ts";
import type { ActivityMonitorTraces } from "../../../features/ingestion-source/services/ingestion-source-activity.service.ts";
import type {
  GovernanceClickHouseClient,
  GovernanceClickHouseResult,
  GovernanceClickHouseResolver,
} from "../../clickhouse/clickhouse.governance-clickhouse.repositories.ts";

type ClickHouseQuery = {
  query: string;
  query_params?: Record<string, unknown>;
  tenantIds?: string[];
  format: "JSONEachRow";
};

class RecordedClickHouseClient implements GovernanceClickHouseClient {
  readonly queries: ClickHouseQuery[] = [];

  constructor(private readonly rowsForQuery: (query: ClickHouseQuery) => unknown) {}

  async query(input: ClickHouseQuery): Promise<GovernanceClickHouseResult> {
    this.queries.push(input);
    return { json: async () => this.rowsForQuery(input) };
  }
}

class RecordedClickHouseResolver implements GovernanceClickHouseResolver {
  readonly organizationIds: string[] = [];

  constructor(private readonly client: GovernanceClickHouseClient) {}

  async getClient(organizationId: string): Promise<GovernanceClickHouseClient> {
    this.organizationIds.push(organizationId);
    return this.client;
  }
}

/** Every trace read the service made, by operation name, with its input. */
type TraceCall = { op: keyof ActivityMonitorTraces; input: Record<string, unknown> };

function activityMonitor(options: {
  prisma: Parameters<typeof prismaDouble>[0];
  rowsForQuery?: (query: ClickHouseQuery) => unknown;
  traces?: Partial<ActivityMonitorTraces>;
}) {
  const clickhouse = new RecordedClickHouseClient(options.rowsForQuery ?? (() => []));
  const resolver = new RecordedClickHouseResolver(clickhouse);
  const traceCalls: TraceCall[] = [];
  const traces = Object.fromEntries(
    Object.entries(options.traces ?? {}).map(([op, read]) => [
      op,
      (input: Record<string, unknown>) => {
        traceCalls.push({ op: op as TraceCall["op"], input });
        return (read as (input: unknown) => unknown)(input);
      },
    ]),
  ) as Partial<ActivityMonitorTraces>;
  const service = createActivityMonitorTestService({
    prisma: prismaDouble(options.prisma),
    clickhouse: resolver,
    traces,
  });

  return { service, clickhouse, resolver, traceCalls };
}

function governanceProjectPrisma() {
  return {
    project: { findFirst: vi.fn(async () => ({ id: "governance-project" })) },
  };
}

const GOVERNANCE_ORIGIN = [{ key: "langwatch.origin.kind", value: "ingestion_source" }];

const userSortCases: [SpendSortField, SortDir][] = [
  ["spend", "asc"],
  ["spend", "desc"],
  ["requests", "asc"],
  ["requests", "desc"],
  ["lastActivity", "asc"],
  ["lastActivity", "desc"],
];

const timeSeriesGroupCases: [
  Extract<SpendOverTimeGroupBy, "user" | "model">,
  TraceDailySpendGroup,
][] = [
  ["user", { kind: "attribute", key: "langwatch.user_id" }],
  ["model", { kind: "firstModel" }],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ActivityMonitorService rollups", () => {
  it("short-circuits an org without a governance project before asking trace", async () => {
    const prisma = {
      project: { findFirst: vi.fn(async () => null) },
      anomalyAlert: {
        groupBy: vi.fn(async () => [{ severity: "critical", _count: { _all: 2 } }]),
      },
    };
    const { service, clickhouse, resolver, traceCalls } = activityMonitor({ prisma });

    const summary = await service.summary({ organizationId: "empty-org", windowDays: 7 });
    const users = await service.spendByUser({ organizationId: "empty-org", windowDays: 7 });
    const teams = await service.spendByTeam({ organizationId: "empty-org", windowDays: 7 });

    expect(summary).toEqual({
      spentThisWindowUsd: 0,
      windowOverPreviousPct: 0,
      hasPriorBaseline: false,
      activeUsersThisWindow: 0,
      newUsersThisWindow: 0,
      openAnomalyCount: 2,
      anomalyBreakdown: { critical: 2, warning: 0, info: 0 },
    });
    expect(users).toEqual([]);
    expect(teams).toEqual([]);
    expect(resolver.organizationIds).toEqual([]);
    expect(clickhouse.queries).toEqual([]);
    expect(traceCalls).toEqual([]);
  });

  it("returns the current and prior governance-only summary with anomaly totals", async () => {
    const prisma = {
      ...governanceProjectPrisma(),
      anomalyAlert: {
        groupBy: vi.fn(async () => [
          { severity: "critical", _count: { _all: 1 } },
          { severity: "warning", _count: { _all: 2 } },
        ]),
      },
    };
    const { service, traceCalls } = activityMonitor({
      prisma,
      traces: {
        getAttributedSpendComparison: async () => ({
          currentSpendUsd: 5,
          previousSpendUsd: 2,
          currentActors: 3,
        }),
      },
    });

    const summary = await service.summary({ organizationId: "org-a", windowDays: 30 });

    expect(summary).toEqual({
      spentThisWindowUsd: 5,
      windowOverPreviousPct: 150,
      hasPriorBaseline: true,
      activeUsersThisWindow: 3,
      newUsersThisWindow: 0,
      openAnomalyCount: 3,
      anomalyBreakdown: { critical: 1, warning: 2, info: 0 },
    });
    expect(traceCalls).toEqual([
      {
        op: "getAttributedSpendComparison",
        input: expect.objectContaining({
          projectId: "governance-project",
          matches: GOVERNANCE_ORIGIN,
          actorKey: "langwatch.user_id",
        }),
      },
    ]);
  });

  it.each(userSortCases)(
    "asks trace for the %s/%s user ordering with tenant-bound pagination",
    async (sortBy, sortDir) => {
      const { service, traceCalls } = activityMonitor({
        prisma: governanceProjectPrisma(),
        traces: {
          findAttributedSpendByValue: async () => [
            {
              value: "member@example.com",
              spentUsd: "0.123456789",
              requests: 2,
              lastOccurredAtMs: 1786619810000,
              firstModel: "gpt-5",
            },
          ],
        },
      });

      const rows = await service.spendByUser({
        organizationId: "org-a",
        windowDays: 30,
        limit: 7,
        offset: 3,
        sortBy,
        sortDir,
      });

      expect(rows).toEqual([
        expect.objectContaining({
          actor: "member@example.com",
          spendUsd: "0.123456789",
          requests: 2,
          mostUsedTarget: "gpt-5",
        }),
      ]);
      expect(traceCalls).toEqual([
        {
          op: "findAttributedSpendByValue",
          input: expect.objectContaining({
            projectId: "governance-project",
            matches: GOVERNANCE_ORIGIN,
            valueKey: "langwatch.user_id",
            sortBy,
            sortDirection: sortDir,
            limit: 7,
            offset: 3,
          }),
        },
      ]);
    },
  );

  it("reads a user without a first model as no most-used target", async () => {
    const { service } = activityMonitor({
      prisma: governanceProjectPrisma(),
      traces: {
        findAttributedSpendByValue: async () => [
          { value: "a@x.test", spentUsd: "1", requests: 1, lastOccurredAtMs: 1, firstModel: "" },
        ],
      },
    });

    const rows = await service.spendByUser({ organizationId: "org-a", windowDays: 30 });

    expect(rows[0]!.mostUsedTarget).toBeNull();
  });

  it("rolls sources into team and org-wide rows before sorting and paging", async () => {
    const prisma = {
      ...governanceProjectPrisma(),
      ingestionSource: {
        findMany: vi.fn(async () => [
          { id: "source-team", team: { id: "team-a", name: "Product" } },
          { id: "source-org", team: null },
        ]),
      },
    };
    const { service, traceCalls } = activityMonitor({
      prisma,
      traces: {
        findAttributedSpendComparisonByValue: async () => [
          {
            value: "source-team",
            currentSpendUsd: "2",
            previousSpendUsd: "1",
            currentRequests: 1,
            lastCurrentOccurredAtMs: 2000,
          },
          {
            value: "source-org",
            currentSpendUsd: "1",
            previousSpendUsd: "3",
            currentRequests: 4,
            lastCurrentOccurredAtMs: 1000,
          },
        ],
      },
    });
    const page = (sortBy: SpendSortField, sortDir: SortDir) =>
      service.spendByTeam({
        organizationId: "org-a",
        windowDays: 30,
        limit: 1,
        offset: 0,
        sortBy,
        sortDir,
      });

    const highestSpend = await page("spend", "desc");
    const lowestSpend = await page("spend", "asc");
    const mostRequests = await page("requests", "desc");
    const mostRecent = await page("lastActivity", "desc");

    expect(highestSpend).toEqual([
      expect.objectContaining({
        teamId: "team-a",
        teamName: "Product",
        spendUsd: "2",
        requestCount: 1,
        sourceCount: 1,
        deltaPctVsPriorWindow: 100,
        hasPriorBaseline: true,
      }),
    ]);
    expect(lowestSpend[0]).toEqual(
      expect.objectContaining({ teamId: null, teamName: "Org-wide", spendUsd: "1" }),
    );
    expect(mostRequests[0]).toEqual(expect.objectContaining({ teamId: null, requestCount: 4 }));
    expect(mostRecent[0]).toEqual(expect.objectContaining({ teamId: "team-a" }));
    expect(prisma.ingestionSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["source-team", "source-org"] }, organizationId: "org-a" },
      }),
    );
    expect(traceCalls).toHaveLength(4);
    for (const call of traceCalls) {
      expect(call.input).toMatchObject({
        projectId: "governance-project",
        matches: GOVERNANCE_ORIGIN,
        valueKey: "langwatch.ingestion_source.id",
      });
    }
  });

  it("keeps a dense daily series and only rolls this org's source mappings into teams", async () => {
    const now = Date.UTC(2026, 7, 25, 14);
    const today = Date.UTC(2026, 7, 25);
    const dayMs = 24 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const prisma = {
      ...governanceProjectPrisma(),
      ingestionSource: {
        findMany: vi.fn(async () => [
          { id: "source-a", team: { id: "team-a", name: "Product" } },
          { id: "source-b", team: { id: "team-a", name: "Product" } },
        ]),
      },
    };
    const { service, traceCalls } = activityMonitor({
      prisma,
      traces: {
        findDailyAttributedSpend: async () => [
          { dayStartMs: today - dayMs, value: "source-a", spentUsd: "1" },
          { dayStartMs: today - dayMs, value: "source-b", spentUsd: "2" },
          { dayStartMs: today, value: "source-elsewhere", spentUsd: "99" },
        ],
      },
    });

    const result = await service.spendOverTime({
      organizationId: "org-a",
      windowDays: 3,
      groupBy: "team",
    });

    expect(result.buckets).toEqual([
      { bucketIso: new Date(today - 2 * dayMs).toISOString(), points: [] },
      {
        bucketIso: new Date(today - dayMs).toISOString(),
        points: [{ key: "team-a", label: "Product", spendUsd: "3" }],
      },
      {
        bucketIso: new Date(today).toISOString(),
        points: [{ key: "__org_wide__", label: "Org-wide", spendUsd: "99" }],
      },
    ]);
    expect(prisma.ingestionSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["source-a", "source-b", "source-elsewhere"] },
          organizationId: "org-a",
        },
      }),
    );
    expect(traceCalls[0]!.input).toMatchObject({
      projectId: "governance-project",
      groupBy: { kind: "attribute", key: "langwatch.ingestion_source.id" },
      window: { startMs: today - 2 * dayMs, endMs: now },
    });
  });

  it("rolls each source's pushed, logged and pulled events into its health row", async () => {
    const prisma = {
      ...governanceProjectPrisma(),
      ingestionSource: {
        findMany: vi.fn(async () => [
          {
            id: "source-a",
            name: "A source",
            sourceType: "otel_generic",
            status: "active",
            lastEventAt: new Date("2026-08-25T10:00:00.000Z"),
          },
          {
            id: "source-b",
            name: "B source",
            sourceType: "anthropic_admin",
            status: "paused",
            lastEventAt: null,
          },
        ]),
      },
    };
    const { service, clickhouse, traceCalls } = activityMonitor({
      prisma,
      rowsForQuery: (query) => {
        if (query.query.includes("FROM stored_log_records")) {
          return [
            { sourceId: "source-a", c: "1" },
            { sourceId: "source-b", c: "7" },
          ];
        }
        return [{ sourceId: "source-a", c: "3" }];
      },
      traces: {
        countAttributedTracesByValue: async () => [{ value: "source-a", count: 2 }],
      },
    });

    const health = await service.ingestionSourcesHealth({ organizationId: "org-a" });

    expect(health).toEqual([
      {
        id: "source-a",
        name: "A source",
        sourceType: "otel_generic",
        status: "active",
        lastEventIso: "2026-08-25T10:00:00.000Z",
        eventsLast24h: 6,
      },
      {
        id: "source-b",
        name: "B source",
        sourceType: "anthropic_admin",
        status: "paused",
        lastEventIso: null,
        eventsLast24h: 7,
      },
    ]);
    expect(clickhouse.queries).toHaveLength(2);
    for (const query of clickhouse.queries) {
      expect(query.query_params).toMatchObject({
        tenantId: "governance-project",
        sourceIds: ["source-a", "source-b"],
      });
    }
    expect(traceCalls[0]!.input).toMatchObject({
      projectId: "governance-project",
      matches: GOVERNANCE_ORIGIN,
      valueKey: "langwatch.ingestion_source.id",
      values: ["source-a", "source-b"],
    });
  });

  it("sums trace's source recency with the logged and pulled windows", async () => {
    const { service, traceCalls } = activityMonitor({
      prisma: governanceProjectPrisma(),
      rowsForQuery: (query) =>
        query.query.includes("FROM stored_log_records")
          ? [{ c24: "1", c7: "2", c30: "3", lastMs: "2000" }]
          : [{ c24: "0", c7: "0", c30: "0", lastMs: null }],
      traces: {
        getAttributedTraceRecency: async () => ({ counts: [4, 5, 6], lastOccurredAtMs: 9000 }),
      },
    });

    const metrics = await service.sourceHealthMetrics({
      organizationId: "org-a",
      sourceId: "source-a",
    });

    expect(metrics).toEqual({
      events24h: 5,
      events7d: 7,
      events30d: 9,
      lastSuccessIso: new Date(9000).toISOString(),
    });
    expect(traceCalls[0]!.input).toMatchObject({
      projectId: "governance-project",
      matches: [...GOVERNANCE_ORIGIN, { key: "langwatch.ingestion_source.id", value: "source-a" }],
    });
  });

  it.each(timeSeriesGroupCases)(
    "asks trace to group the time series by %s",
    async (groupBy, group) => {
      const { service, traceCalls } = activityMonitor({
        prisma: governanceProjectPrisma(),
        traces: { findDailyAttributedSpend: async () => [] },
      });

      await service.spendOverTime({ organizationId: "org-a", windowDays: 1, groupBy });

      expect(traceCalls[0]!.input).toMatchObject({
        projectId: "governance-project",
        groupBy: group,
      });
    },
  );

  it("attributes organization-project spend by user, team, project, then Unassigned", async () => {
    const prisma = {
      project: {
        findMany: vi.fn(async () => [
          { id: "project-a", departmentId: "department-project" },
          { id: "project-b", departmentId: null },
        ]),
      },
      organizationUser: {
        findMany: vi.fn(async () => [
          {
            departmentId: "department-user",
            user: { email: "direct@example.com", teamMemberships: [] },
          },
          {
            departmentId: null,
            user: {
              email: "team@example.com",
              teamMemberships: [{ team: { departmentId: "department-team" } }],
            },
          },
        ]),
      },
      department: {
        findMany: vi.fn(async () => [
          { id: "department-user", name: "User department" },
          { id: "department-team", name: "Team department" },
          { id: "department-project", name: "Project department" },
        ]),
      },
    };
    const spend = (projectId: string, value: string, spentUsd: string, requests: number) => ({
      projectId,
      value,
      spentUsd,
      requests,
      lastOccurredAtMs: 1000,
    });
    const { service, traceCalls } = activityMonitor({
      prisma,
      traces: {
        findSpendByProjectAndValue: async () => [
          spend("project-a", "direct@example.com", "4", 2),
          spend("project-a", "team@example.com", "3", 1),
          spend("project-a", "", "2", 1),
          spend("project-b", "", "1", 1),
        ],
      },
    });

    const rows = await service.spendByDepartment({ organizationId: "org-a", windowDays: 30 });

    expect(rows).toEqual([
      expect.objectContaining({ departmentId: "department-user", spendUsd: "4", requestCount: 2 }),
      expect.objectContaining({ departmentId: "department-team", spendUsd: "3", requestCount: 1 }),
      expect.objectContaining({
        departmentId: "department-project",
        spendUsd: "2",
        requestCount: 1,
      }),
      expect.objectContaining({
        departmentId: null,
        departmentName: "Unassigned",
        spendUsd: "1",
        requestCount: 1,
      }),
    ]);
    expect(traceCalls[0]!.input).toMatchObject({
      projectIds: ["project-a", "project-b"],
      valueKey: "langwatch.user_id",
    });
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { team: { organizationId: "org-a" }, archivedAt: null },
      }),
    );
  });
});
