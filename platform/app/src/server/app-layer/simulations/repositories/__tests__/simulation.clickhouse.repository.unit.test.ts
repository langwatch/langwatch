import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";
import type { WindowFragment } from "../../../clients/clickhouse/windowed-read";
import {
  buildStartedAtWindowClause,
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

      it("normalizes the latest version's set id, resolved with argMax", async () => {
        const mockClient = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        const firstCallArg = (mockClient.query as ReturnType<typeof vi.fn>).mock
          .calls[0]?.[0] as { query: string } | undefined;
        expect(firstCallArg?.query).toContain("IF(LatestSetId = '',");
        expect(firstCallArg?.query).toContain(
          "argMax(ScenarioSetId, UpdatedAt) AS LatestSetId",
        );
        // Grouping by ScenarioSetId would split a run whose pre-started version
        // still carries '' into a second group, reporting it under 'default'.
        expect(firstCallArg?.query).toContain(
          "GROUP BY TenantId, ScenarioRunId",
        );
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

  describe("getRunDataForScenarioSet() run read", () => {
    /** Batch page rows, optionally carrying the page's StartedAt bounds. */
    function makeRepoCapturingRunRead(batchRow: Record<string, string>): {
      repo: SimulationClickHouseRepository;
      runQuery: () =>
        | { query: string; params: Record<string, unknown> }
        | undefined;
    } {
      const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
        rowsForQuery: (query) =>
          query.includes("GROUP BY BatchRunId") ? [batchRow] : [],
      });
      const repo = new SimulationClickHouseRepository(
        vi.fn().mockResolvedValue(client),
      );
      return {
        repo,
        runQuery: () =>
          getCapturedQueries().find((q) =>
            q.query.includes("Messages.Content"),
          ),
      };
    }

    describe("when the batch page carries a StartedAt range", () => {
      // The run read is the heaviest on the table (it materialises message
      // content). Without a StartedAt predicate it opens every weekly partition,
      // cold storage included, to serve one page.
      it("bounds both the outer read and the dedup scope to the page window", async () => {
        const { repo, runQuery } = makeRepoCapturingRunRead({
          BatchRunId: "batch-1",
          MaxCreatedAt: "9000",
          MinStartedAt: "1000",
          MaxStartedAt: "9000",
        });

        await repo.getRunDataForScenarioSet({
          projectId: "project-1",
          scenarioSetId: "set-1",
        });

        const runRead = runQuery();
        expect(runRead?.query).toContain(
          "AND t.StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String}))",
        );
        expect(runRead?.query).toContain(
          "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String}))",
        );
        expect(runRead?.params.minStartedAtMs).toBe("1000");
        expect(runRead?.params.maxStartedAtMs).toBe("9000");
      });
    });

    describe("when the batch page has no usable StartedAt", () => {
      it("runs the read unbounded rather than dropping the page", async () => {
        const { repo, runQuery } = makeRepoCapturingRunRead({
          BatchRunId: "batch-1",
          MaxCreatedAt: "9000",
          MinStartedAt: "0",
          MaxStartedAt: "0",
        });

        await repo.getRunDataForScenarioSet({
          projectId: "project-1",
          scenarioSetId: "set-1",
        });

        expect(runQuery()?.query).not.toContain("minStartedAtMs");
        expect(runQuery()?.params.minStartedAtMs).toBeUndefined();
      });
    });
  });

  describe("findRunStatus()", () => {
    function makeRepoCapturingStatusRead(rows: unknown[]) {
      const { client, getCapturedQueries } = makeMockClientWithQueryCapture({
        rowsForQuery: () => rows,
      });
      return {
        repo: new SimulationClickHouseRepository(
          vi.fn().mockResolvedValue(client),
        ),
        statusQuery: () => getCapturedQueries()[0],
      };
    }

    describe("when the run has a stored row", () => {
      it("answers with the latest version's status", async () => {
        const { repo } = makeRepoCapturingStatusRead([{ Status: "SUCCESS" }]);

        await expect(
          repo.findRunStatus({
            projectId: "project-1",
            scenarioRunId: "run-1",
          }),
        ).resolves.toBe("SUCCESS");
      });
    });

    describe("when nothing has been stored for the run", () => {
      it("answers that nothing is known about it", async () => {
        const { repo } = makeRepoCapturingStatusRead([]);

        await expect(
          repo.findRunStatus({
            projectId: "project-1",
            scenarioRunId: "run-1",
          }),
        ).resolves.toBeNull();
      });
    });

    describe("when the run was archived after it ran", () => {
      // The caller asks "has anything already reached this run?" before
      // executing it. Filtering archived rows out would answer "nothing is
      // known", and the scenario would be run — and billed — a second time.
      /** @scenario "A run archived after it ran is still recognised as already run" */
      it("does not hide the archived run's status", async () => {
        const { repo, statusQuery } = makeRepoCapturingStatusRead([
          { Status: "SUCCESS" },
        ]);

        await repo.findRunStatus({
          projectId: "project-1",
          scenarioRunId: "run-1",
        });

        expect(statusQuery()?.query).not.toContain("ArchivedAt");
      });
    });

    describe("when reading the status", () => {
      it("filters by tenant before anything else", async () => {
        const { repo, statusQuery } = makeRepoCapturingStatusRead([]);

        await repo.findRunStatus({
          projectId: "project-1",
          scenarioRunId: "run-1",
        });

        const query = statusQuery()?.query ?? "";
        expect(query.indexOf("TenantId = {tenantId:String}")).toBeLessThan(
          query.indexOf("ScenarioRunId = {scenarioRunId:String}"),
        );
        expect(statusQuery()?.params).toMatchObject({
          tenantId: "project-1",
          scenarioRunId: "run-1",
        });
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
        const { whereClause, params } = buildStartedAtWindowClause({
          window: windowFragment(1000, 9000),
        });
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

    describe("when the outer query aliases the table", () => {
      // LIST_COLUMNS projects `toString(...) AS StartedAt`; without the
      // qualifier the comparison resolves to that String alias.
      it("qualifies the column with the alias", () => {
        const { whereClause } = buildStartedAtWindowClause({
          window: windowFragment(1000, 9000),
          alias: "t",
        });
        expect(whereClause).toBe(
          "AND t.StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) " +
            "AND t.StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
        );
      });
    });

    describe("when given a null (unbounded) fragment", () => {
      it("emits an empty clause with no params", () => {
        expect(buildStartedAtWindowClause({ window: null })).toEqual({
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
