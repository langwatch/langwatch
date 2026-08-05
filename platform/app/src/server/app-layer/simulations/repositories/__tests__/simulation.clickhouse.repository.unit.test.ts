import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";
import type { ClickHouseSimulationRunRow } from "~/server/simulations/simulation-run.mappers";
import type { WindowFragment } from "../../../clients/clickhouse/windowed-read";
import {
  buildStartedAtWindowClause,
  RUN_OUTCOMES_ROW_CAP,
  SimulationClickHouseRepository,
  startedAtBoundsForPage,
} from "../simulation.clickhouse.repository";

/** A windowed-read fragment carrying the page's [min, max] StartedAt bounds. */
function windowFragment(fromMs: number, toMs: number): WindowFragment {
  return {
    fromMs,
    toMs,
    params: { fromMs, toMs },
    sqlFor: (column) =>
      `AND ${column} >= fromUnixTimestamp64Milli({fromMs:Int64}) ` +
      `AND ${column} <= fromUnixTimestamp64Milli({toMs:Int64})`,
  };
}

/** Reads the windowed-read outcome counter straight off the prom registry, for
 *  the simulation_runs table — a spy on a destructured copy would pass
 *  regardless. */
async function simulationOutcomeCount(outcome: string): Promise<number> {
  const { register } = await import("prom-client");
  const metric = await register
    .getSingleMetric("clickhouse_windowed_read_total")
    ?.get();
  return (
    metric?.values.find(
      (v) =>
        v.labels.table === "simulation_runs" && v.labels.outcome === outcome,
    )?.value ?? 0
  );
}

/** A settled LIST_COLUMNS row, carrying only what the ordering assertions read. */
function runRow({
  scenarioRunId,
  createdAtMs,
}: {
  scenarioRunId: string;
  createdAtMs: number;
}): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: scenarioRunId,
    ScenarioId: `scenario-${scenarioRunId}`,
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: scenarioRunId,
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "10",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    // StartedAt drives ScenarioRunData.timestamp, so it tracks CreatedAt here.
    StartedAt: String(createdAtMs),
    CreatedAt: String(createdAtMs),
    UpdatedAt: String(createdAtMs),
    FinishedAt: String(createdAtMs),
    ArchivedAt: null,
  };
}

function makeMockClient(rows: unknown[] = []): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue(rows);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
}

function makeMockClientWithQueryCapture(options?: {
  rowsForQuery?: (query: string) => unknown[];
}): {
  client: ClickHouseClient;
  getCapturedQueries: () => {
    query: string;
    params: Record<string, unknown>;
  }[];
} {
  const capturedQueries: { query: string; params: Record<string, unknown> }[] =
    [];
  const queryFn = vi.fn().mockImplementation(({ query, query_params }) => {
    capturedQueries.push({ query, params: query_params });
    const rows = options?.rowsForQuery?.(query) ?? [];
    return Promise.resolve({ json: () => Promise.resolve(rows) });
  });
  return {
    client: { query: queryFn } as unknown as ClickHouseClient,
    getCapturedQueries: () => capturedQueries,
  };
}

describe("SimulationClickHouseRepository", () => {
  describe("getDistinctExternalSetIds()", () => {
    describe("when called with projectIds", () => {
      it("resolves the client via first projectId, not 'unknown'", async () => {
        const mockClient = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getDistinctExternalSetIds({
          projectIds: ["project-1", "project-2"],
        });

        expect(resolver).toHaveBeenCalledWith("project-1");
        expect(resolver).not.toHaveBeenCalledWith("unknown");
      });

      it("sends a SQL query containing the IF normalization expression", async () => {
        const mockClient = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        const firstCallArg = (mockClient.query as ReturnType<typeof vi.fn>).mock
          .calls[0]?.[0] as { query: string } | undefined;
        expect(firstCallArg?.query).toContain("IF(ScenarioSetId = '',");
      });
    });

    describe("when called with empty projectIds", () => {
      it("returns empty set without calling the resolver", async () => {
        const resolver = vi.fn();
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: [],
        });

        expect(result).toEqual(new Set());
        expect(resolver).not.toHaveBeenCalled();
      });
    });

    describe("when ClickHouse returns both empty-string and 'default' ScenarioSetId", () => {
      it("normalizes empty string to DEFAULT_SET_ID and returns one distinct set", async () => {
        const mockClient = makeMockClient([
          { ScenarioSetId: "" },
          { ScenarioSetId: DEFAULT_SET_ID },
        ]);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        expect(result).toEqual(new Set([DEFAULT_SET_ID]));
        expect(result.size).toBe(1);
      });
    });

    describe("when ClickHouse returns only empty-string ScenarioSetId", () => {
      it("normalizes empty string to DEFAULT_SET_ID", async () => {
        const mockClient = makeMockClient([{ ScenarioSetId: "" }]);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        expect(result).toEqual(new Set([DEFAULT_SET_ID]));
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when ClickHouse returns empty string for ScenarioSetId", () => {
      it("normalizes empty ScenarioSetId to 'default' in the returned scenarioSetIds", async () => {
        const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
          rowsForQuery: (query) => {
            if (query.includes("GROUP BY BatchRunId")) {
              return [
                {
                  BatchRunId: "batch-1",
                  MaxCreatedAt: "1710000000000",
                  NormalizedSetId: "default",
                },
              ];
            }
            return [];
          },
        });
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getRunDataForAllSuites({
          projectId: "project-1",
        });

        expect(result.changed).toBe(true);
        if (result.changed) {
          expect(result.scenarioSetIds["batch-1"]).toBe("default");
        }

        const queries = getCapturedQueries();
        const batchQuery = queries.find((q) =>
          q.query.includes("GROUP BY BatchRunId"),
        );
        expect(batchQuery?.query).toContain(
          "IF(ScenarioSetId = '', 'default', ScenarioSetId)",
        );
        expect(batchQuery?.query).not.toMatch(
          /any\(ScenarioSetId\)\s+AS\s+ScenarioSetId/,
        );
      });
    });

    // Regression: ClickHouse rejects queries where a SELECT alias shadows a
    // column referenced in WHERE — the aggregate any(IF(...)) must NOT be
    // aliased as ScenarioSetId because the dedup IN-tuple in WHERE references
    // the underlying ScenarioSetId column.
    // See: simulation.clickhouse.repository.ts getRunDataForAllSuites()
    describe("when the outer SELECT aggregates the normalized set id", () => {
      it("does not alias the aggregate as ScenarioSetId (would shadow the column in WHERE)", async () => {
        const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
          rowsForQuery: () => [],
        });
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getRunDataForAllSuites({ projectId: "project-1" });

        const batchQuery = getCapturedQueries().find((q) =>
          q.query.includes("GROUP BY BatchRunId"),
        );
        expect(batchQuery?.query).not.toMatch(
          /any\(IF\(ScenarioSetId[^)]*\)\)\s+AS\s+ScenarioSetId\b/,
        );
        expect(batchQuery?.query).toMatch(
          /any\(IF\(ScenarioSetId[^)]*\)\)\s+AS\s+NormalizedSetId\b/,
        );
      });
    });
  });

  describe("findRunOutcomesForBatchIds()", () => {
    describe("given more runs across the batches than the cap holds", () => {
      it("keeps the newest rows by ordering descending under the cap", async () => {
        const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
          rowsForQuery: () => [],
        });
        const repo = new SimulationClickHouseRepository(
          vi.fn().mockResolvedValue(client),
        );

        await repo.findRunOutcomesForBatchIds({
          projectId: "project-1",
          batchRunIds: ["batch-1", "batch-2"],
        });

        const query = getCapturedQueries()[0]?.query ?? "";
        expect(query).toContain("ORDER BY t.CreatedAt DESC");
        expect(query).toContain(`LIMIT ${RUN_OUTCOMES_ROW_CAP}`);
        // Ascending would shed the newest batches, which is the half the run
        // report's trend section exists to compare against.
        expect(query).not.toMatch(/ORDER BY\s+t?\.?CreatedAt ASC/);
      });
    });

    describe("when ClickHouse returns the capped page newest-first", () => {
      it("returns the runs oldest-first", async () => {
        const { client } = makeMockClientWithQueryCapture({
          rowsForQuery: () => [
            runRow({ scenarioRunId: "run-c", createdAtMs: 3000 }),
            runRow({ scenarioRunId: "run-b", createdAtMs: 2000 }),
            runRow({ scenarioRunId: "run-a", createdAtMs: 1000 }),
          ],
        });
        const repo = new SimulationClickHouseRepository(
          vi.fn().mockResolvedValue(client),
        );

        const runs = await repo.findRunOutcomesForBatchIds({
          projectId: "project-1",
          batchRunIds: ["batch-1"],
        });

        expect(runs.map((run) => run.scenarioRunId)).toEqual([
          "run-a",
          "run-b",
          "run-c",
        ]);
        expect(runs.map((run) => run.timestamp)).toEqual([1000, 2000, 3000]);
      });
    });

    describe("when rows share a CreatedAt millisecond", () => {
      it("orders the tie by scenario run id rather than arbitrarily", async () => {
        const { client } = makeMockClientWithQueryCapture({
          rowsForQuery: () => [
            runRow({ scenarioRunId: "run-b", createdAtMs: 1000 }),
            runRow({ scenarioRunId: "run-c", createdAtMs: 1000 }),
            runRow({ scenarioRunId: "run-a", createdAtMs: 1000 }),
          ],
        });
        const repo = new SimulationClickHouseRepository(
          vi.fn().mockResolvedValue(client),
        );

        const runs = await repo.findRunOutcomesForBatchIds({
          projectId: "project-1",
          batchRunIds: ["batch-1"],
        });

        expect(runs.map((run) => run.scenarioRunId)).toEqual([
          "run-a",
          "run-b",
          "run-c",
        ]);
      });
    });

    describe("when no batch ids are given", () => {
      it("returns empty without querying ClickHouse", async () => {
        const resolver = vi.fn();
        const repo = new SimulationClickHouseRepository(resolver);

        const runs = await repo.findRunOutcomesForBatchIds({
          projectId: "project-1",
          batchRunIds: [],
        });

        expect(runs).toEqual([]);
        expect(resolver).not.toHaveBeenCalled();
      });
    });
  });

  describe("startedAtBoundsForPage()", () => {
    it("spans the min and max StartedAt across the page rows", () => {
      const bounds = startedAtBoundsForPage([
        { MinStartedAt: "3000", MaxStartedAt: "5000" },
        { MinStartedAt: "1000", MaxStartedAt: "9000" },
      ]);
      expect(bounds).toEqual({ minMs: 1000, maxMs: 9000 });
    });

    it("handles a single row", () => {
      const bounds = startedAtBoundsForPage([
        { MinStartedAt: "1500", MaxStartedAt: "1500" },
      ]);
      expect(bounds).toEqual({ minMs: 1500, maxMs: 1500 });
    });

    it("returns null for an empty page (no hint — unbounded read)", () => {
      expect(startedAtBoundsForPage([])).toBeNull();
    });

    it("returns null when all bounds are non-finite or non-positive", () => {
      expect(
        startedAtBoundsForPage([
          { MinStartedAt: "not-a-number", MaxStartedAt: "0" },
          { MinStartedAt: "", MaxStartedAt: "NaN" },
        ]),
      ).toBeNull();
    });

    it("still bounds when some rows have invalid values but others are valid", () => {
      const bounds = startedAtBoundsForPage([
        { MinStartedAt: "0", MaxStartedAt: "invalid" },
        { MinStartedAt: "2000", MaxStartedAt: "4000" },
      ]);
      expect(bounds).toEqual({ minMs: 2000, maxMs: 4000 });
    });
  });

  describe("buildStartedAtWindowClause()", () => {
    describe("when given a windowed fragment", () => {
      it("emits the byte-identical StartedAt predicate with String bounds", () => {
        const { whereClause, params } = buildStartedAtWindowClause(
          windowFragment(1000, 9000),
        );
        expect(whereClause).toBe(
          "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) " +
            "AND StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
        );
        expect(params).toEqual({
          minStartedAtMs: "1000",
          maxStartedAtMs: "9000",
        });
      });
    });

    describe("when given a null (unbounded) fragment", () => {
      it("emits an empty clause with no params", () => {
        expect(buildStartedAtWindowClause(null)).toEqual({
          whereClause: "",
          params: {},
        });
      });
    });
  });

  describe("getBatchHistoryForScenarioSet() step-2 windowed read", () => {
    function makeRepoCapturing(minStartedAt: string, maxStartedAt: string) {
      const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
        rowsForQuery: (query) => {
          if (query.includes("count(DISTINCT BatchRunId)")) {
            return [{ TotalBatchCount: "1" }];
          }
          if (query.includes("AS MinStartedAt")) {
            return [
              {
                BatchRunId: "batch-1",
                TotalCount: "1",
                PassCount: "1",
                FailCount: "0",
                RunningCount: "0",
                LastUpdatedAt: "5000",
                LastRunAt: "5000",
                FirstCompletedAt: "5000",
                AllCompletedAt: "5000",
                MinStartedAt: minStartedAt,
                MaxStartedAt: maxStartedAt,
              },
            ];
          }
          // step 2 (preview columns) — rows irrelevant to the assertions
          return [];
        },
      });
      const repo = new SimulationClickHouseRepository(
        vi.fn().mockResolvedValue(client),
      );
      const step2Query = () =>
        getCapturedQueries().find((q) =>
          q.query.includes("MessagePreviewRoles"),
        );
      return { repo, step2Query };
    }

    describe("when the page carries a StartedAt range", () => {
      it("bounds step 2 with the byte-identical window and records a hit", async () => {
        const before = await simulationOutcomeCount("hit");
        const { repo, step2Query } = makeRepoCapturing("1000", "9000");

        await repo.getBatchHistoryForScenarioSet({
          projectId: "project-1",
          scenarioSetId: "set-1",
        });

        const step2 = step2Query();
        expect(step2?.query).toContain(
          "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String}))",
        );
        expect(step2?.query).toContain(
          "AND StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
        );
        expect(step2?.params.minStartedAtMs).toBe("1000");
        expect(step2?.params.maxStartedAtMs).toBe("9000");
        expect(await simulationOutcomeCount("hit")).toBe(before + 1);
      });
    });

    describe("when the page has no usable StartedAt (provisional/zero)", () => {
      it("runs step 2 unbounded and records it as unwindowed", async () => {
        const before = await simulationOutcomeCount("unwindowed");
        const { repo, step2Query } = makeRepoCapturing("0", "0");

        await repo.getBatchHistoryForScenarioSet({
          projectId: "project-1",
          scenarioSetId: "set-1",
        });

        const step2 = step2Query();
        expect(step2?.query).not.toContain("minStartedAtMs");
        expect(step2?.params.minStartedAtMs).toBeUndefined();
        expect(await simulationOutcomeCount("unwindowed")).toBe(before + 1);
      });
    });
  });
});
