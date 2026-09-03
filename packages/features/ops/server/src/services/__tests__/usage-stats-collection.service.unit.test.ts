import { describe, expect, it, vi } from "vitest";
import {
  UsageStatsClickHouseClient,
  UsageStatsClickHouseClientResolver,
  type UsageStatsClickHouseQuery,
} from "../../index";
import {
  UsageStatsClickHouseRepository,
  UsageStatsProjectRepository,
  type UsageStatsProjectDatabase,
  type UsageStatsProjectCounts,
} from "../../ports/usage-stats-worker.ports";
import { ClickHouseUsageStatsRepository } from "../../repositories/clickhouse/clickhouse.usage-stats.repository";
import { PrismaUsageStatsProjectRepository } from "../../repositories/prisma/prisma.usage-stats-project.repository";
import { UsageStatsCollectionService } from "../usage-stats-collection.service";

const projectCounts: UsageStatsProjectCounts = {
  projectIds: ["project-1"],
  annotations: 1,
  annotationQueues: 2,
  annotationQueueItems: 3,
  annotationScores: 4,
  batchEvaluations: 5,
  customGraphs: 6,
  datasets: 7,
  datasetRecords: 8,
  experiments: 9,
  triggers: 10,
  workflows: 11,
};

class ProjectsFake extends UsageStatsProjectRepository {
  readonly collectProjectCounts = vi.fn<
    (input: {
      organizationId: string;
      builderChartKind: string;
    }) => Promise<UsageStatsProjectCounts>
  >(async () => projectCounts);
}

class CountsFake extends UsageStatsClickHouseRepository {
  readonly findTraceCount = vi.fn(async () => 200);
  readonly findScenarioRunCount = vi.fn(async () => 75);
}

class ClickHouseClientFake extends UsageStatsClickHouseClient {
  readonly query =
    vi.fn<(input: UsageStatsClickHouseQuery) => ReturnType<typeof queryResult>>();
}

class ClickHouseClientsFake extends UsageStatsClickHouseClientResolver {
  readonly tryResolve =
    vi.fn<(organizationId: string) => Promise<UsageStatsClickHouseClient | null>>();
}

function queryResult(total: string) {
  return Promise.resolve({
    json: async () => [{ Total: total }],
  });
}

function serviceFor({
  projects = new ProjectsFake(),
  clickhouse = new CountsFake(),
}: {
  projects?: ProjectsFake;
  clickhouse?: CountsFake;
} = {}) {
  const service = UsageStatsCollectionService.create({
    projects,
    clickhouse,
    builderChartKind: "builder",
    now: () => new Date("2026-08-25T12:00:00.000Z"),
  });
  return { service, projects, clickhouse };
}

describe("UsageStatsCollectionService", () => {
  it("preserves every report field for the requested organization", async () => {
    const { service, projects, clickhouse } = serviceFor();

    await expect(service.collect({ organizationId: "organization-1" })).resolves.toEqual({
      totalTraces: 200,
      totalScenarioEvents: 75,
      annotations: 1,
      annotationQueues: 2,
      annotationQueueItems: 3,
      annotationScores: 4,
      batchEvaluations: 5,
      customGraphs: 6,
      datasets: 7,
      datasetRecords: 8,
      experiments: 9,
      triggers: 10,
      workflows: 11,
      timestamp: "2026-08-25T12:00:00.000Z",
    });
    expect(projects.collectProjectCounts).toHaveBeenCalledWith({
      organizationId: "organization-1",
      builderChartKind: "builder",
    });
    expect(clickhouse.findTraceCount).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectIds: ["project-1"],
    });
    expect(clickhouse.findScenarioRunCount).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectIds: ["project-1"],
    });
  });
});

describe("PrismaUsageStatsProjectRepository", () => {
  it("counts every original project-scoped report field and only builder charts", async () => {
    const findMany = vi.fn(async () => [{ id: "project-1" }]);
    const count = vi.fn(async () => 3);
    const customGraphCount = vi.fn(async () => 6);
    const database: UsageStatsProjectDatabase = {
      project: { findMany },
      annotation: { count },
      annotationQueue: { count },
      annotationQueueItem: { count },
      annotationScore: { count },
      batchEvaluation: { count },
      customGraph: { count: customGraphCount },
      dataset: { count },
      datasetRecord: { count },
      experiment: { count },
      trigger: { count },
      workflow: { count },
    };
    const repository = PrismaUsageStatsProjectRepository.create(database);

    await expect(
      repository.collectProjectCounts({
        organizationId: "organization-1",
        builderChartKind: "builder",
      }),
    ).resolves.toEqual({
      projectIds: ["project-1"],
      annotations: 3,
      annotationQueues: 3,
      annotationQueueItems: 3,
      annotationScores: 3,
      batchEvaluations: 3,
      customGraphs: 6,
      datasets: 3,
      datasetRecords: 3,
      experiments: 3,
      triggers: 3,
      workflows: 3,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { team: { organizationId: "organization-1" } },
      select: { id: true },
    });
    expect(count).toHaveBeenCalledWith({ where: { projectId: { in: ["project-1"] } } });
    expect(customGraphCount).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] }, kind: "builder" },
    });
  });
});

describe("ClickHouseUsageStatsRepository", () => {
  it("returns zero without projects or an available ClickHouse client", async () => {
    const clients = new ClickHouseClientsFake();
    const repository = ClickHouseUsageStatsRepository.create(clients);

    await expect(
      repository.findTraceCount({ organizationId: "organization-1", projectIds: [] }),
    ).resolves.toBe(0);

    clients.tryResolve.mockResolvedValue(null);
    await expect(
      repository.findScenarioRunCount({
        organizationId: "organization-1",
        projectIds: ["project-1"],
      }),
    ).resolves.toBe(0);
  });

  it("uses the existing trace_summaries and simulation_runs queries unchanged", async () => {
    const client = new ClickHouseClientFake();
    client.query.mockImplementationOnce(() => queryResult("200"));
    client.query.mockImplementationOnce(() => queryResult("75"));
    const clients = new ClickHouseClientsFake();
    clients.tryResolve.mockResolvedValue(client);
    const repository = ClickHouseUsageStatsRepository.create(clients);
    const input = { organizationId: "organization-1", projectIds: ["project-1"] };

    await expect(repository.findTraceCount(input)).resolves.toBe(200);
    await expect(repository.findScenarioRunCount(input)).resolves.toBe(75);

    expect(client.query).toHaveBeenNthCalledWith(1, {
      query: expect.stringContaining(
        "SELECT toString(count(DISTINCT TraceId)) AS Total\n        FROM trace_summaries",
      ),
      query_params: { projectIds: ["project-1"] },
      format: "JSONEachRow",
    });
    expect(client.query).toHaveBeenNthCalledWith(2, {
      query: expect.stringContaining(
        "SELECT toString(count()) AS Total\n        FROM simulation_runs AS t",
      ),
      query_params: { projectIds: ["project-1"] },
      format: "JSONEachRow",
    });
    const traceQuery = client.query.mock.calls[0]?.[0].query;
    expect(traceQuery).not.toContain("trace_analytics");
    expect(traceQuery).not.toMatch(/rollup|timeseries/i);

    const scenarioQuery = client.query.mock.calls[1]?.[0].query;
    expect(scenarioQuery).not.toContain("LIMIT 1 BY");
    expect(scenarioQuery).not.toMatch(/SELECT\s+\*\s+FROM\s+simulation_runs/i);
    expect(scenarioQuery).toContain("AND t.ArchivedAt IS NULL");
    expect(scenarioQuery).toContain("max(UpdatedAt)");
    expect(scenarioQuery).toContain(
      "GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId",
    );
  });
});
