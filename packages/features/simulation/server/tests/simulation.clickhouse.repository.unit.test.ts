import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { SimulationReadClient } from "../src/adapters/simulation.clickhouse.adapter";
import {
  RUN_ID_CAP,
  SimulationClickHouseRepository,
} from "../src/repositories/clickhouse/simulation-clickhouse.repository";
import {
  type SimulationWindowFragment,
  SimulationWindowedReadPort,
  type SimulationWindowedReadInput,
} from "../src/ports/simulation-windowed-read.port";

type QueryCall = {
  query: string;
  params: Record<string, string | string[]>;
};

class FixtureClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly rows: unknown[][] = []) {}

  readonly client: SimulationReadClient = {
    query: async ({ query, query_params }) => {
      this.calls.push({ query, params: query_params });
      const rows = this.rows.shift() ?? [];
      return {
        json: async <Result>() => rows as Result[],
      };
    },
  };
}

class FixtureWindowedRead extends SimulationWindowedReadPort {
  readonly inputs: SimulationWindowedReadInput<unknown>[] = [];

  constructor(private readonly window: SimulationWindowFragment | null = null) {
    super();
  }

  async query<Result>(input: SimulationWindowedReadInput<Result>): Promise<Result> {
    this.inputs.push(input);
    return input.run(this.window);
  }
}

function makeWindow(fromMs: number, toMs: number): SimulationWindowFragment {
  return {
    fromMs,
    toMs,
    params: { fromMs, toMs },
    sqlFor: (column) => `AND ${column} >= {fromMs:Int64} AND ${column} <= {toMs:Int64}`,
  };
}

function makeRepository(rows: unknown[][] = [], windowedRead = new FixtureWindowedRead()) {
  const fixture = new FixtureClient(rows);
  return {
    fixture,
    windowedRead,
    repository: SimulationClickHouseRepository.create(async () => fixture.client, windowedRead),
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test",
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: "1000",
    CreatedAt: "1000",
    UpdatedAt: "2500",
    FinishedAt: "2500",
    ArchivedAt: null,
    ExportSortKey: "1000",
    ...overrides,
  };
}

function aggregateRow(overrides: Record<string, string> = {}) {
  return {
    BatchRunId: "batch-1",
    TotalCount: "1",
    PassCount: "1",
    FailCount: "0",
    RunningCount: "0",
    SettledCount: "1",
    StalledCount: "0",
    LastUpdatedAt: "5000",
    LastRunAt: "5000",
    FirstCompletedAt: "5000",
    AllCompletedAt: "5000",
    MinStartedAt: "1000",
    MaxStartedAt: "9000",
    ...overrides,
  };
}

describe("SimulationClickHouseRepository", () => {
  it("looks up a run by tenant and run id, returning only the latest matching row", async () => {
    const { fixture, repository } = makeRepository([
      [runRow({ ScenarioRunId: "run-1", Status: "SUCCESS", UpdatedAt: "9000" })],
    ]);

    await expect(
      repository.tryGetScenarioRunData({
        projectId: "project-1",
        scenarioRunId: "run-1",
      }),
    ).resolves.toMatchObject({ scenarioRunId: "run-1", status: "SUCCESS" });

    expect(fixture.calls[0]?.params).toEqual({
      tenantId: "project-1",
      scenarioRunId: "run-1",
    });
    expect(fixture.calls[0]?.query).toContain("t.ScenarioRunId = {scenarioRunId:String}");
    expect(fixture.calls[0]?.query).toContain("max(s.UpdatedAt)");
  });

  it("returns no run for an index lookup with no matching row", async () => {
    const { repository } = makeRepository([[]]);

    await expect(
      repository.tryGetScenarioRunData({
        projectId: "project-1",
        scenarioRunId: "missing-run",
      }),
    ).resolves.toBeNull();
  });

  it("never serves secret values from stored run metadata", async () => {
    const metadata = {
      parameters: { account_tier: "gold" },
      secretParameterNames: ["api_token"],
      secretParameters: { api_token: "encrypted-token" },
    };
    const { repository } = makeRepository([[runRow({ Metadata: JSON.stringify(metadata) })]]);

    const run = await repository.tryGetScenarioRunData({
      projectId: "project-1",
      scenarioRunId: "run-1",
    });

    expect(run?.metadata).toEqual({
      parameters: { account_tier: "gold" },
      secretParameterNames: ["api_token"],
    });
  });

  it("adds date and decoded cursor filters to a paginated scenario-set query", async () => {
    const { fixture, repository } = makeRepository([
      [{ BatchRunId: "batch-2", MaxCreatedAt: "4000" }],
      [runRow({ BatchRunId: "batch-2" })],
    ]);
    const cursor = Buffer.from(JSON.stringify({ ts: "5000", batchRunId: "batch-5" })).toString(
      "base64",
    );

    await repository.getRunDataForScenarioSet({
      projectId: "project-1",
      scenarioSetId: "set-1",
      cursor,
      startDate: 1_700_000_000_000,
      endDate: 1_700_100_000_000,
    });

    expect(fixture.calls[0]?.params).toMatchObject({
      tenantId: "project-1",
      scenarioSetIds: ["set-1"],
      cursorTs: "5000",
      cursorBatchRunId: "batch-5",
      startDateMs: "1700000000000",
      endDateMs: "1700100000000",
    });
  });

  it("does not send date parameters when list reads have no requested range", async () => {
    const { fixture, repository } = makeRepository([[]]);

    await repository.getRunDataForAllSuites({ projectId: "project-1" });

    expect(fixture.calls[0]?.params).not.toHaveProperty("startDateMs");
    expect(fixture.calls[0]?.params).not.toHaveProperty("endDateMs");
  });

  it("normalizes the default set in all-suite results without shadowing the source column", async () => {
    const { fixture, repository } = makeRepository([
      [
        {
          BatchRunId: "batch-1",
          MaxCreatedAt: "1710000000000",
          NormalizedSetId: "default",
        },
      ],
      [],
    ]);

    const result = await repository.getRunDataForAllSuites({
      projectId: "project-1",
    });

    expect(result).toMatchObject({
      changed: true,
      scenarioSetIds: { "batch-1": "default" },
    });
    expect(fixture.calls[0]?.query).toContain(
      "any(IF(ScenarioSetId = '', 'default', ScenarioSetId)) AS NormalizedSetId",
    );
    expect(fixture.calls[0]?.query).not.toMatch(
      /any\(IF\(ScenarioSetId[^)]*\)\)\s+AS\s+ScenarioSetId\b/,
    );
  });

  it("uses the explicit window adapter for the history preview query", async () => {
    const windowedRead = new FixtureWindowedRead(makeWindow(1_000, 9_000));
    const { fixture, repository } = makeRepository(
      [[{ TotalBatchCount: "1" }], [aggregateRow()], []],
      windowedRead,
    );

    await repository.getBatchHistoryForScenarioSet({
      projectId: "project-1",
      scenarioSetId: "set-1",
    });

    const preview = fixture.calls.find((call) => call.query.includes("MessagePreviewRoles"));
    expect(windowedRead.inputs).toHaveLength(1);
    expect(windowedRead.inputs[0]).toMatchObject({
      table: "simulation_runs",
      fallback: "none",
      hintMs: 5000,
      windowMs: 4000,
    });
    expect(preview?.params).toMatchObject({
      minStartedAtMs: "1000",
      maxStartedAtMs: "9000",
    });
  });

  it("makes a provisional history page explicitly unbounded", async () => {
    const windowedRead = new FixtureWindowedRead();
    const { fixture, repository } = makeRepository(
      [[{ TotalBatchCount: "1" }], [aggregateRow({ MinStartedAt: "0", MaxStartedAt: "0" })], []],
      windowedRead,
    );

    await repository.getBatchHistoryForScenarioSet({
      projectId: "project-1",
      scenarioSetId: "set-1",
    });

    const preview = fixture.calls.find((call) => call.query.includes("MessagePreviewRoles"));
    expect(windowedRead.inputs[0]).toMatchObject({ hintMs: null, fallback: "none" });
    expect(preview?.params).not.toHaveProperty("minStartedAtMs");
  });

  it("calculates valid page bounds and renders the stable window clause", () => {
    expect(
      SimulationClickHouseRepository.tryStartedAtBoundsForPage([
        { MinStartedAt: "3000", MaxStartedAt: "5000" },
        { MinStartedAt: "1000", MaxStartedAt: "9000" },
      ]),
    ).toEqual({ minMs: 1000, maxMs: 9000 });
    expect(SimulationClickHouseRepository.tryStartedAtBoundsForPage([])).toBeNull();
    expect(
      SimulationClickHouseRepository.tryStartedAtBoundsForPage([
        { MinStartedAt: "0", MaxStartedAt: "NaN" },
      ]),
    ).toBeNull();
    expect(
      SimulationClickHouseRepository.buildStartedAtWindowClause(makeWindow(1000, 9000)),
    ).toEqual({
      whereClause:
        "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) AND StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
      params: { minStartedAtMs: "1000", maxStartedAtMs: "9000" },
    });
  });

  it("caps set run IDs and treats the default storage aliases as one set", async () => {
    const rows = Array.from({ length: RUN_ID_CAP }, (_, index) => ({
      ScenarioRunId: `run-${index}`,
    }));
    const { fixture, repository } = makeRepository([rows]);

    const result = await repository.findAllRunIdsForSet({
      projectId: "project-1",
      scenarioSetId: "default",
    });

    expect(result).toMatchObject({ reachedCap: true });
    expect(result.runIds).toHaveLength(RUN_ID_CAP);
    expect(fixture.calls[0]?.params.scenarioSetIds).toEqual(["default", ""]);
    expect(fixture.calls[0]?.query).toContain("ArchivedAt IS NULL");
    expect(fixture.calls[0]?.query).not.toContain("LIMIT 1 BY");
    expect(fixture.calls[0]?.query).toMatch(
      /GROUP BY\s+TenantId,\s*ScenarioSetId,\s*BatchRunId,\s*ScenarioRunId/,
    );
  });

  it("normalizes external set ids and avoids a resolver call for no projects", async () => {
    const empty = makeRepository();
    await expect(empty.repository.getDistinctExternalSetIds({ projectIds: [] })).resolves.toEqual(
      new Set(),
    );
    expect(empty.fixture.calls).toHaveLength(0);

    const { repository } = makeRepository([[{ ScenarioSetId: "" }, { ScenarioSetId: "default" }]]);
    await expect(
      repository.getDistinctExternalSetIds({ projectIds: ["project-1"] }),
    ).resolves.toEqual(new Set(["default"]));
  });

  it("keeps export count and sweep filters aligned, with the date filter outside dedup", async () => {
    const { fixture, repository } = makeRepository([
      [{ Total: "2" }],
      [
        runRow({ ScenarioRunId: "run-1", ExportSortKey: "1000" }),
        runRow({ ScenarioRunId: "run-2", ExportSortKey: "2000" }),
      ],
    ]);

    await expect(
      repository.countRunsForExport({
        projectId: "project-1",
        scenarioSetId: "default",
        scenarioId: "scenario-1",
        startDate: 100,
        endDate: 200,
      }),
    ).resolves.toBe(2);
    const page = await repository.findRunsForExport({
      projectId: "project-1",
      scenarioSetId: "default",
      scenarioId: "scenario-1",
      startDate: 100,
      endDate: 200,
      limit: 1,
    });

    expect(page).toMatchObject({ hasMore: true, runs: [{ scenarioRunId: "run-1" }] });
    const [count, sweep] = fixture.calls;
    expect(count?.params).toMatchObject({
      exportSetIds: ["default", ""],
      exportScenarioId: "scenario-1",
      startDateMs: "100",
      endDateMs: "200",
    });
    expect(sweep?.query).toContain(
      "ORDER BY toUnixTimestamp64Milli(ifNull(t.StartedAt, t.CreatedAt)) ASC, t.ScenarioRunId ASC",
    );
    expect(sweep?.query).toContain("t.StartedAt >=");
    expect(sweep?.query).toContain("AND t.ArchivedAt IS NULL");
    expect(sweep?.query).toContain("max(UpdatedAt)");
  });
});
