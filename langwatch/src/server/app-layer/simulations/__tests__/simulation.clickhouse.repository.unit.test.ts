import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { STALL_THRESHOLD_MS } from "~/server/scenarios/stall-detection";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

function makeRunRow(overrides: Record<string, string | null> = {}) {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test",
    Messages: "[]",
    TraceIds: "[]",
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: "[]",
    UnmetCriteria: "[]",
    Error: null,
    DurationMs: "1500",
    CreatedAt: "1000",
    UpdatedAt: "2500",
    FinishedAt: "2500",
    ArchivedAt: null,
    ...overrides,
  };
}

function createMockClickHouse(jsonResult: unknown[] = []) {
  const jsonFn = vi.fn().mockResolvedValue(jsonResult);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn, command: vi.fn() } as unknown as ClickHouseClient;
}

function setQueryResult(
  clickhouse: ClickHouseClient,
  result: unknown[],
) {
  const jsonFn = vi.fn().mockResolvedValue(result);
  (clickhouse.query as ReturnType<typeof vi.fn>).mockResolvedValue({
    json: jsonFn,
  });
}

function setQueryResults(
  clickhouse: ClickHouseClient,
  results: unknown[][],
) {
  const queryFn = clickhouse.query as ReturnType<typeof vi.fn>;
  for (const result of results) {
    const jsonFn = vi.fn().mockResolvedValue(result);
    queryFn.mockResolvedValueOnce({ json: jsonFn });
  }
}

describe("SimulationClickHouseRepository", () => {
  let clickhouse: ClickHouseClient;
  let repo: SimulationClickHouseRepository;

  beforeEach(() => {
    clickhouse = createMockClickHouse();
    repo = new SimulationClickHouseRepository(async () => clickhouse);
  });

  describe("getBatchRunCountForScenarioSet()", () => {
    describe("when rows exist", () => {
      it("returns the count", async () => {
        setQueryResult(clickhouse, [{ BatchRunCount: "5" }]);

        const count = await repo.getBatchRunCountForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(count).toBe(5);
      });
    });

    describe("when no rows exist", () => {
      it("returns 0", async () => {
        setQueryResult(clickhouse, []);

        const count = await repo.getBatchRunCountForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(count).toBe(0);
      });
    });

    it("passes correct query params", async () => {
      setQueryResult(clickhouse, [{ BatchRunCount: "0" }]);

      await repo.getBatchRunCountForScenarioSet({
        projectId: "proj-1",
        scenarioSetId: "set-1",
      });

      expect(clickhouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: { tenantId: "proj-1", scenarioSetIds: ["set-1"] },
        }),
      );
    });
  });

  describe("getAllRunDataForScenarioSet()", () => {
    describe("when rows exist", () => {
      it("returns all mapped runs", async () => {
        setQueryResult(clickhouse, [
          makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
          makeRunRow({ ScenarioRunId: "run-2", BatchRunId: "batch-1" }),
          makeRunRow({ ScenarioRunId: "run-3", BatchRunId: "batch-2" }),
        ]);

        const result = await repo.getAllRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(result).toHaveLength(3);
      });
    });

    describe("when no rows exist", () => {
      it("returns empty array", async () => {
        setQueryResult(clickhouse, []);

        const result = await repo.getAllRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(result).toEqual([]);
      });
    });
  });

  describe("getRunDataForScenarioSet()", () => {
    describe("when first page has results and more pages", () => {
      it("returns runs, cursor, and hasMore=true", async () => {
        setQueryResults(clickhouse, [
          [
            { BatchRunId: "batch-1", MaxCreatedAt: "3000" },
            { BatchRunId: "batch-2", MaxCreatedAt: "2000" },
            { BatchRunId: "batch-3", MaxCreatedAt: "1000" },
          ],
          [
            makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
            makeRunRow({ ScenarioRunId: "run-2", BatchRunId: "batch-2" }),
          ],
        ]);

        const result = await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          limit: 2,
        });

        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
        expect(result.runs).toHaveLength(2);
      });
    });

    describe("when last page has no more results", () => {
      it("returns hasMore=false and no cursor", async () => {
        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-1", MaxCreatedAt: "3000" }],
          [makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" })],
        ]);

        const result = await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          limit: 20,
        });

        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeUndefined();
        expect(result.runs).toHaveLength(1);
      });
    });

    describe("when no results at all", () => {
      it("returns empty response", async () => {
        setQueryResult(clickhouse, []);

        const result = await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(result).toEqual({
          runs: [],
          nextCursor: undefined,
          hasMore: false,
        });
      });
    });

    describe("when cursor is provided", () => {
      it("passes decoded cursor values as query params", async () => {
        const cursor = Buffer.from(
          JSON.stringify({ ts: "5000", batchRunId: "batch-5" }),
        ).toString("base64");

        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-6", MaxCreatedAt: "4000" }],
          [makeRunRow({ ScenarioRunId: "run-6", BatchRunId: "batch-6" })],
        ]);

        await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          cursor,
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({
              cursorTs: "5000",
              cursorBatchRunId: "batch-5",
            }),
          }),
        );
      });
    });

    describe("when cursor is malformed", () => {
      it("ignores the cursor and returns first page", async () => {
        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-1", MaxCreatedAt: "3000" }],
          [makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" })],
        ]);

        const result = await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          cursor: "not-valid-base64!!!",
        });

        expect(result.runs).toHaveLength(1);
        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.not.objectContaining({
              cursorTs: expect.any(String),
            }),
          }),
        );
      });
    });

    describe("when limit exceeds maximum", () => {
      it("clamps to 100", async () => {
        setQueryResult(clickhouse, []);

        await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          limit: 999,
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({
              fetchLimit: "101",
            }),
          }),
        );
      });
    });

    describe("when startDate and endDate are provided", () => {
      it("includes date parameters in the query", async () => {
        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-1", MaxCreatedAt: "3000" }],
          [makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" })],
        ]);

        await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          startDate: 1000,
          endDate: 5000,
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({
              startDateMs: "1000",
              endDateMs: "5000",
            }),
          }),
        );
      });

      it("uses HAVING clause with max(CreatedAt) for atomic batch filtering", async () => {
        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-1", MaxCreatedAt: "3000" }],
          [makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" })],
        ]);

        await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          startDate: 1000,
          endDate: 5000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query: string };
        expect(call.query).toContain("toUnixTimestamp64Milli(max(CreatedAt)) >= toUInt64({startDateMs:String})");
        expect(call.query).toContain("toUnixTimestamp64Milli(max(CreatedAt)) <= toUInt64({endDateMs:String})");
      });
    });

    describe("when no date range is provided", () => {
      it("omits date parameters from the query", async () => {
        setQueryResults(clickhouse, [
          [{ BatchRunId: "batch-1", MaxCreatedAt: "3000" }],
          [makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" })],
        ]);

        await repo.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.not.objectContaining({
              startDateMs: expect.any(String),
            }),
          }),
        );
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when results exist with scenarioSetIds", () => {
      it("returns runs, scenarioSetIds map, and pagination info", async () => {
        setQueryResults(clickhouse, [
          [
            {
              BatchRunId: "batch-1",
              MaxCreatedAt: "3000",
              NormalizedSetId: "__internal__foo__suite",
            },
            {
              BatchRunId: "batch-2",
              MaxCreatedAt: "2000",
              NormalizedSetId: "__internal__bar__suite",
            },
          ],
          [
            makeRunRow({
              ScenarioRunId: "run-1",
              BatchRunId: "batch-1",
              ScenarioSetId: "__internal__foo__suite",
            }),
            makeRunRow({
              ScenarioRunId: "run-2",
              BatchRunId: "batch-2",
              ScenarioSetId: "__internal__bar__suite",
            }),
          ],
        ]);

        const result = await repo.getRunDataForAllSuites({
          projectId: "proj-1",
          limit: 20,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs).toHaveLength(2);
        expect(result.scenarioSetIds).toEqual({
          "batch-1": "__internal__foo__suite",
          "batch-2": "__internal__bar__suite",
        });
        expect(result.hasMore).toBe(false);
      });
    });

    describe("when no results exist", () => {
      it("returns empty response with empty scenarioSetIds", async () => {
        setQueryResult(clickhouse, []);

        const result = await repo.getRunDataForAllSuites({
          projectId: "proj-1",
        });

        expect(result).toEqual({
          changed: true,
          lastUpdatedAt: 0,
          runs: [],
          scenarioSetIds: {},
          nextCursor: undefined,
          hasMore: false,
        });
      });
    });

    describe("when more pages available", () => {
      it("returns hasMore=true with cursor", async () => {
        setQueryResults(clickhouse, [
          [
            {
              BatchRunId: "batch-1",
              MaxCreatedAt: "3000",
              NormalizedSetId: "__internal__a__suite",
            },
            {
              BatchRunId: "batch-2",
              MaxCreatedAt: "2000",
              NormalizedSetId: "__internal__b__suite",
            },
          ],
          [
            makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
          ],
        ]);

        const result = await repo.getRunDataForAllSuites({
          projectId: "proj-1",
          limit: 1,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
      });
    });

    it("queries without suite-specific filtering", async () => {
      setQueryResult(clickhouse, []);

      await repo.getRunDataForAllSuites({ projectId: "proj-1" });

      const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as { query: string };
      // getRunDataForAllSuites fetches all runs (suite filtering is done by getSetSummaries)
      expect(call.query).toContain("TenantId");
      expect(call.query).not.toContain("__internal__");
    });
  });

  describe("getBatchHistoryForScenarioSet()", () => {
    /** Batch-aggregate row as returned by the step-1 query. */
    function makeBatchRow(overrides: Record<string, string> = {}) {
      return {
        BatchRunId: "batch-1",
        TotalCount: "3",
        PassCount: "1",
        FailCount: "0",
        RunningCount: "2",
        LastUpdatedAt: "9000",
        LastRunAt: "9000",
        FirstCompletedAt: "0",
        AllCompletedAt: "0",
        ...overrides,
      };
    }

    /** Slim preview item row as returned by the step-2 query. */
    function makeItemRow(
      overrides: Record<string, string | string[] | null> = {},
    ) {
      return {
        ScenarioRunId: "run-1",
        BatchRunId: "batch-1",
        Name: "Test run",
        Description: null,
        Status: "IN_PROGRESS",
        DurationMs: null,
        UpdatedAt: String(Date.now()),
        FinishedAt: null,
        MessagePreviewRoles: [],
        MessagePreviewContents: [],
        ...overrides,
      };
    }

    describe("given a batch with mixed finished, stalled, and active runs", () => {
      describe("when the batch history is resolved", () => {
        it("derives STALLED at read time for unfinished runs past the stall threshold", async () => {
          const now = Date.now();
          const staleTs = String(now - STALL_THRESHOLD_MS - 60_000);
          const freshTs = String(now - 1_000);

          setQueryResults(clickhouse, [
            [{ TotalBatchCount: "1" }],
            [makeBatchRow({ RunningCount: "2" })],
            [
              // Run A: finished with SUCCESS -> keeps its stored status
              makeItemRow({
                ScenarioRunId: "run-A",
                Status: "SUCCESS",
                FinishedAt: "5000",
                UpdatedAt: "5000",
              }),
              // Run B: unfinished, last update beyond the threshold -> STALLED
              makeItemRow({
                ScenarioRunId: "run-B",
                Status: "IN_PROGRESS",
                FinishedAt: null,
                UpdatedAt: staleTs,
              }),
              // Run C: unfinished, fresh -> IN_PROGRESS
              makeItemRow({
                ScenarioRunId: "run-C",
                Status: "IN_PROGRESS",
                FinishedAt: null,
                UpdatedAt: freshTs,
              }),
            ],
          ]);

          const result = await repo.getBatchHistoryForScenarioSet({
            projectId: "proj-1",
            scenarioSetId: "set-1",
          });

          const batch = result.batches[0]!;
          const statusByRunId = new Map(
            batch.items.map((i) => [i.scenarioRunId, i.status]),
          );
          expect(statusByRunId.get("run-A")).toBe(ScenarioRunStatus.SUCCESS);
          expect(statusByRunId.get("run-B")).toBe(ScenarioRunStatus.STALLED);
          expect(statusByRunId.get("run-C")).toBe(
            ScenarioRunStatus.IN_PROGRESS,
          );
        });

        it("derives stalledCount and subtracts it from runningCount", async () => {
          const now = Date.now();
          const staleTs = String(now - STALL_THRESHOLD_MS - 60_000);
          const freshTs = String(now - 1_000);

          setQueryResults(clickhouse, [
            [{ TotalBatchCount: "1" }],
            [makeBatchRow({ RunningCount: "2" })],
            [
              makeItemRow({
                ScenarioRunId: "run-A",
                Status: "SUCCESS",
                FinishedAt: "5000",
                UpdatedAt: "5000",
              }),
              makeItemRow({
                ScenarioRunId: "run-B",
                Status: "IN_PROGRESS",
                FinishedAt: null,
                UpdatedAt: staleTs,
              }),
              makeItemRow({
                ScenarioRunId: "run-C",
                Status: "IN_PROGRESS",
                FinishedAt: null,
                UpdatedAt: freshTs,
              }),
            ],
          ]);

          const result = await repo.getBatchHistoryForScenarioSet({
            projectId: "proj-1",
            scenarioSetId: "set-1",
          });

          const batch = result.batches[0]!;
          expect(batch.stalledCount).toBe(1);
          expect(batch.runningCount).toBe(1);
        });
      });
    });

    describe("given more stalled items than the stored RunningCount", () => {
      describe("when the batch history is resolved", () => {
        it("clamps runningCount at zero", async () => {
          const staleTs = String(Date.now() - STALL_THRESHOLD_MS - 60_000);

          setQueryResults(clickhouse, [
            [{ TotalBatchCount: "1" }],
            // Stored as STALLED, so it is not counted in RunningCount…
            [makeBatchRow({ RunningCount: "0", TotalCount: "1", PassCount: "0" })],
            [
              // …but the item is still unfinished and stale, so it re-derives
              // STALLED at read time; RunningCount - stalledCount would go
              // negative without the clamp.
              makeItemRow({
                ScenarioRunId: "run-B",
                Status: "STALLED",
                FinishedAt: null,
                UpdatedAt: staleTs,
              }),
            ],
          ]);

          const result = await repo.getBatchHistoryForScenarioSet({
            projectId: "proj-1",
            scenarioSetId: "set-1",
          });

          const batch = result.batches[0]!;
          expect(batch.stalledCount).toBe(1);
          expect(batch.runningCount).toBe(0);
        });
      });
    });

    describe("given a finished run whose last update is older than the threshold", () => {
      describe("when the batch history is resolved", () => {
        it("keeps the stored terminal status instead of deriving STALLED", async () => {
          const staleTs = String(Date.now() - STALL_THRESHOLD_MS - 60_000);

          setQueryResults(clickhouse, [
            [{ TotalBatchCount: "1" }],
            [makeBatchRow({ RunningCount: "0", TotalCount: "1" })],
            [
              makeItemRow({
                ScenarioRunId: "run-A",
                Status: "SUCCESS",
                FinishedAt: staleTs,
                UpdatedAt: staleTs,
              }),
            ],
          ]);

          const result = await repo.getBatchHistoryForScenarioSet({
            projectId: "proj-1",
            scenarioSetId: "set-1",
          });

          const batch = result.batches[0]!;
          expect(batch.items[0]!.status).toBe(ScenarioRunStatus.SUCCESS);
          expect(batch.stalledCount).toBe(0);
        });
      });
    });

    describe("when startDate and endDate are provided", () => {
      it("passes date parameters for partition pruning", async () => {
        setQueryResults(clickhouse, [
          [{ TotalBatchCount: "0" }],
          [],
        ]);

        await repo.getBatchHistoryForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          startDate: 1000,
          endDate: 5000,
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({
              startDateMs: "1000",
              endDateMs: "5000",
            }),
          }),
        );
      });
    });
  });

  describe("cursor roundtrip", () => {
    it("encodes and decodes correctly through pagination", async () => {
      setQueryResults(clickhouse, [
        [
          { BatchRunId: "batch-a", MaxCreatedAt: "5000" },
          { BatchRunId: "batch-b", MaxCreatedAt: "4000" },
        ],
        [makeRunRow({ BatchRunId: "batch-a" })],
      ]);

      const page1 = await repo.getRunDataForScenarioSet({
        projectId: "proj-1",
        scenarioSetId: "set-1",
        limit: 1,
      });

      expect(page1.nextCursor).toBeDefined();

      const decoded = JSON.parse(
        Buffer.from(page1.nextCursor!, "base64").toString("utf-8"),
      );
      expect(decoded).toEqual({ ts: "5000", batchRunId: "batch-a" });
    });
  });
});
