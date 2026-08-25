import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GovernanceClickHouseClientPort,
  type GovernanceClickHouseResult,
  GovernanceClickHouseResolverPort,
} from "../src/ports/ingestion-source-activity.port";
import {
  PrismaActivityMonitorRepository,
  type SortDir,
  type SpendOverTimeGroupBy,
  type SpendSortField,
} from "../src/repositories/prisma/prisma.ingestion-source-activity.repository";

type ClickHouseQuery = {
  query: string;
  query_params?: Record<string, unknown>;
  format: "JSONEachRow";
};

class RecordedClickHouseClient extends GovernanceClickHouseClientPort {
  readonly queries: ClickHouseQuery[] = [];

  constructor(private readonly rowsForQuery: (query: ClickHouseQuery) => unknown) {
    super();
  }

  async query(input: ClickHouseQuery): Promise<GovernanceClickHouseResult> {
    this.queries.push(input);
    return { json: async () => this.rowsForQuery(input) };
  }
}

class RecordedClickHouseResolver extends GovernanceClickHouseResolverPort {
  readonly organizationIds: string[] = [];

  constructor(private readonly client: GovernanceClickHouseClientPort | null) {
    super();
  }

  async tryResolve(
    organizationId: string,
  ): Promise<GovernanceClickHouseClientPort | null> {
    this.organizationIds.push(organizationId);
    return this.client;
  }
}

function activityMonitor(options: {
  prisma: object;
  rowsForQuery: (query: ClickHouseQuery) => unknown;
}) {
  const clickhouse = new RecordedClickHouseClient(options.rowsForQuery);
  const resolver = new RecordedClickHouseResolver(clickhouse);
  const service = PrismaActivityMonitorRepository.create({
    prisma: options.prisma,
    clickhouse: resolver,
  });

  return { service, clickhouse, resolver };
}

function governanceProjectPrisma() {
  return {
    project: { findFirst: vi.fn(async () => ({ id: "governance-project" })) },
  };
}

const userSortCases: Array<[SpendSortField, SortDir, string]> = [
  ["spend", "asc", "sum(spendUsd) ASC"],
  ["spend", "desc", "sum(spendUsd) DESC"],
  ["requests", "asc", "count() ASC"],
  ["requests", "desc", "count() DESC"],
  ["lastActivity", "asc", "max(occurredAt) ASC"],
  ["lastActivity", "desc", "max(occurredAt) DESC"],
];

const timeSeriesGroupCases: Array<
  [Extract<SpendOverTimeGroupBy, "user" | "model">, string]
> = [
  ["user", "ts.Attributes[{userKey:String}] AS groupKey"],
  ["model", "arrayElement(ts.Models, 1) AS groupKey"],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrismaActivityMonitorRepository rollups", () => {
  it("short-circuits an org without a governance project before resolving ClickHouse", async () => {
    const prisma = {
      project: { findFirst: vi.fn(async () => null) },
      anomalyAlert: {
        groupBy: vi.fn(async () => [{ severity: "critical", _count: { _all: 2 } }]),
      },
    };
    const { service, clickhouse, resolver } = activityMonitor({
      prisma,
      rowsForQuery: () => [],
    });

    const summary = await service.summary({ organizationId: "empty-org", windowDays: 7 });
    const users = await service.spendByUser({
      organizationId: "empty-org",
      windowDays: 7,
    });
    const teams = await service.spendByTeam({
      organizationId: "empty-org",
      windowDays: 7,
    });

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
    const { service, clickhouse } = activityMonitor({
      prisma,
      rowsForQuery: () => [{ thisSpend: "5", prevSpend: "2", thisUsers: "3" }],
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
    expect(clickhouse.queries[0]!.query).toContain("ts.TenantId = {tenantId:String}");
    expect(clickhouse.queries[0]!.query_params).toMatchObject({
      tenantId: "governance-project",
      originKey: "langwatch.origin.kind",
    });
  });

  it.each(userSortCases)(
    "uses the %s/%s user ordering with tenant-bound pagination",
    async (sortBy, sortDir, orderBy) => {
      const { service, clickhouse } = activityMonitor({
        prisma: governanceProjectPrisma(),
        rowsForQuery: () => [
          {
            actor: "member@example.com",
            spendUsdStr: "0.123456789",
            requests: "2",
            lastActivityMs: "1786619810000",
            mostUsedTarget: "gpt-5",
          },
        ],
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
      expect(clickhouse.queries).toHaveLength(1);
      const query = clickhouse.queries[0]!;
      expect(query.query).toContain(`ORDER BY ${orderBy}`);
      expect(query.query).toContain("ts.TenantId = {tenantId:String}");
      expect(query.query_params).toMatchObject({
        tenantId: "governance-project",
        originKey: "langwatch.origin.kind",
        limit: 7,
        offset: 3,
      });
    },
  );

  it("rolls sources into team and org-wide rows before sorting and paging", async () => {
    const prisma = {
      ...governanceProjectPrisma(),
      ingestionSource: {
        findMany: vi.fn(async () => [
          {
            id: "source-team",
            teamId: "team-a",
            team: { id: "team-a", name: "Product" },
          },
          { id: "source-org", teamId: null, team: null },
        ]),
      },
    };
    const { service, clickhouse } = activityMonitor({
      prisma,
      rowsForQuery: () => [
        {
          sourceId: "source-team",
          thisSpendStr: "2",
          prevSpendStr: "1",
          thisRequests: "1",
          lastActivityMs: "2000",
        },
        {
          sourceId: "source-org",
          thisSpendStr: "1",
          prevSpendStr: "3",
          thisRequests: "4",
          lastActivityMs: "1000",
        },
      ],
    });

    const highestSpend = await service.spendByTeam({
      organizationId: "org-a",
      windowDays: 30,
      limit: 1,
      offset: 0,
      sortBy: "spend",
      sortDir: "desc",
    });
    const lowestSpend = await service.spendByTeam({
      organizationId: "org-a",
      windowDays: 30,
      limit: 1,
      offset: 0,
      sortBy: "spend",
      sortDir: "asc",
    });
    const mostRequests = await service.spendByTeam({
      organizationId: "org-a",
      windowDays: 30,
      limit: 1,
      offset: 0,
      sortBy: "requests",
      sortDir: "desc",
    });
    const mostRecent = await service.spendByTeam({
      organizationId: "org-a",
      windowDays: 30,
      limit: 1,
      offset: 0,
      sortBy: "lastActivity",
      sortDir: "desc",
    });

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
    expect(mostRequests[0]).toEqual(
      expect.objectContaining({ teamId: null, requestCount: 4 }),
    );
    expect(mostRecent[0]).toEqual(expect.objectContaining({ teamId: "team-a" }));
    expect(prisma.ingestionSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["source-team", "source-org"] }, organizationId: "org-a" },
      }),
    );
    expect(clickhouse.queries).toHaveLength(4);
    for (const query of clickhouse.queries) {
      expect(query.query_params).toMatchObject({
        tenantId: "governance-project",
        originKey: "langwatch.origin.kind",
      });
    }
  });

  it("keeps a dense daily series and only rolls this org's source mappings into teams", async () => {
    const now = Date.UTC(2026, 7, 25, 14);
    const today = Date.UTC(2026, 7, 25);
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
    const { service, clickhouse } = activityMonitor({
      prisma,
      rowsForQuery: () => [
        {
          bucketMs: String(today - 24 * 60 * 60 * 1000),
          groupKey: "source-a",
          spendUsdStr: "1",
        },
        {
          bucketMs: String(today - 24 * 60 * 60 * 1000),
          groupKey: "source-b",
          spendUsdStr: "2",
        },
        { bucketMs: String(today), groupKey: "source-elsewhere", spendUsdStr: "99" },
      ],
    });

    const result = await service.spendOverTime({
      organizationId: "org-a",
      windowDays: 3,
      groupBy: "team",
    });

    expect(result.buckets).toEqual([
      { bucketIso: new Date(today - 2 * 24 * 60 * 60 * 1000).toISOString(), points: [] },
      {
        bucketIso: new Date(today - 24 * 60 * 60 * 1000).toISOString(),
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
    expect(clickhouse.queries[0]!.query_params).toMatchObject({
      tenantId: "governance-project",
      windowStart: today - 2 * 24 * 60 * 60 * 1000,
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
    const { service, clickhouse } = activityMonitor({
      prisma,
      rowsForQuery: (query) => {
        if (query.query.includes("FROM trace_summaries")) {
          return [{ sourceId: "source-a", c: "2" }];
        }

        if (query.query.includes("FROM stored_log_records")) {
          return [
            { sourceId: "source-a", c: "1" },
            { sourceId: "source-b", c: "7" },
          ];
        }

        return [{ sourceId: "source-a", c: "3" }];
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
    expect(clickhouse.queries).toHaveLength(3);
    for (const query of clickhouse.queries) {
      expect(query.query_params).toMatchObject({
        tenantId: "governance-project",
        sourceIds: ["source-a", "source-b"],
      });
    }
  });

  it.each(timeSeriesGroupCases)(
    "uses the %s source expression for time-series groups",
    async (groupBy, expression) => {
      const { service, clickhouse } = activityMonitor({
        prisma: governanceProjectPrisma(),
        rowsForQuery: () => [],
      });

      await service.spendOverTime({ organizationId: "org-a", windowDays: 1, groupBy });

      expect(clickhouse.queries[0]!.query).toContain(expression);
      expect(clickhouse.queries[0]!.query_params).toMatchObject({
        tenantId: "governance-project",
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
    const { service, clickhouse } = activityMonitor({
      prisma,
      rowsForQuery: () => [
        {
          projectId: "project-a",
          actor: "direct@example.com",
          spendUsdStr: "4",
          requests: "2",
          lastActivityMs: "4000",
        },
        {
          projectId: "project-a",
          actor: "team@example.com",
          spendUsdStr: "3",
          requests: "1",
          lastActivityMs: "3000",
        },
        {
          projectId: "project-a",
          actor: "",
          spendUsdStr: "2",
          requests: "1",
          lastActivityMs: "2000",
        },
        {
          projectId: "project-b",
          actor: "",
          spendUsdStr: "1",
          requests: "1",
          lastActivityMs: "1000",
        },
      ],
    });

    const rows = await service.spendByDepartment({
      organizationId: "org-a",
      windowDays: 30,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        departmentId: "department-user",
        spendUsd: "4",
        requestCount: 2,
      }),
      expect.objectContaining({
        departmentId: "department-team",
        spendUsd: "3",
        requestCount: 1,
      }),
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
    expect(clickhouse.queries[0]!.query_params).toMatchObject({
      tenantIds: ["project-a", "project-b"],
    });
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { team: { organizationId: "org-a" }, archivedAt: null },
      }),
    );
  });
});
