import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseSimulationService } from "../clickhouse-simulation.service";

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
    DeletedAt: null,
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

describe("ClickHouseSimulationService", () => {
  let clickhouse: ClickHouseClient;
  let service: ClickHouseSimulationService;

  beforeEach(() => {
    clickhouse = createMockClickHouse();
    service = new ClickHouseSimulationService(clickhouse);
  });

  describe("getBatchRunCountForScenarioSet()", () => {
    describe("when rows exist", () => {
      it("returns the count", async () => {
        setQueryResult(clickhouse, [{ BatchRunCount: "5" }]);

        const count = await service.getBatchRunCountForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(count).toBe(5);
      });
    });

    describe("when no rows exist", () => {
      it("returns 0", async () => {
        setQueryResult(clickhouse, []);

        const count = await service.getBatchRunCountForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(count).toBe(0);
      });
    });

    it("passes correct query params", async () => {
      setQueryResult(clickhouse, [{ BatchRunCount: "0" }]);

      await service.getBatchRunCountForScenarioSet({
        projectId: "proj-1",
        scenarioSetId: "set-1",
      });

      expect(clickhouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: { tenantId: "proj-1", scenarioSetId: "set-1" },
        }),
      );
    });
  });

  describe("getScenarioRunDataByScenarioId()", () => {
    describe("when rows exist", () => {
      it("returns mapped scenario run data", async () => {
        setQueryResult(clickhouse, [
          makeRunRow({ ScenarioRunId: "run-1" }),
          makeRunRow({ ScenarioRunId: "run-2" }),
        ]);

        const result = await service.getScenarioRunDataByScenarioId({
          projectId: "proj-1",
          scenarioId: "scenario-1",
        });

        expect(result).toHaveLength(2);
        expect(result![0]!.scenarioRunId).toBe("run-1");
        expect(result![1]!.scenarioRunId).toBe("run-2");
      });
    });

    describe("when no rows exist", () => {
      it("returns null", async () => {
        setQueryResult(clickhouse, []);

        const result = await service.getScenarioRunDataByScenarioId({
          projectId: "proj-1",
          scenarioId: "scenario-1",
        });

        expect(result).toBeNull();
      });
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

        const result = await service.getAllRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        expect(result).toHaveLength(3);
      });
    });

    describe("when no rows exist", () => {
      it("returns empty array", async () => {
        setQueryResult(clickhouse, []);

        const result = await service.getAllRunDataForScenarioSet({
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
        // First query: batch IDs (limit+1 = 3 rows means hasMore)
        // Second query: run data for those batch IDs
        setQueryResults(clickhouse, [
          [
            { BatchRunId: "batch-1", MaxCreatedAt: "3000" },
            { BatchRunId: "batch-2", MaxCreatedAt: "2000" },
            { BatchRunId: "batch-3", MaxCreatedAt: "1000" }, // extra row → hasMore
          ],
          [
            makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
            makeRunRow({ ScenarioRunId: "run-2", BatchRunId: "batch-2" }),
          ],
        ]);

        const result = await service.getRunDataForScenarioSet({
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

        const result = await service.getRunDataForScenarioSet({
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

        const result = await service.getRunDataForScenarioSet({
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

        await service.getRunDataForScenarioSet({
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

        const result = await service.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          cursor: "not-valid-base64!!!",
        });

        expect(result.runs).toHaveLength(1);
        // No cursor params should be in the query
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

        await service.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          limit: 999,
        });

        expect(clickhouse.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: expect.objectContaining({
              fetchLimit: "101", // 100 + 1
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

        await service.getRunDataForScenarioSet({
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

        await service.getRunDataForScenarioSet({
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

        await service.getRunDataForScenarioSet({
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
              ScenarioSetId: "__internal__foo__suite",
            },
            {
              BatchRunId: "batch-2",
              MaxCreatedAt: "2000",
              ScenarioSetId: "__internal__bar__suite",
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

        const result = await service.getRunDataForAllSuites({
          projectId: "proj-1",
          limit: 20,
        });

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

        const result = await service.getRunDataForAllSuites({
          projectId: "proj-1",
        });

        expect(result).toEqual({
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
              ScenarioSetId: "__internal__a__suite",
            },
            {
              BatchRunId: "batch-2",
              MaxCreatedAt: "2000",
              ScenarioSetId: "__internal__b__suite",
            },
          ],
          [
            makeRunRow({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
          ],
        ]);

        const result = await service.getRunDataForAllSuites({
          projectId: "proj-1",
          limit: 1,
        });

        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
      });
    });

    it("uses LIKE pattern for internal suites", async () => {
      setQueryResult(clickhouse, []);

      await service.getRunDataForAllSuites({ projectId: "proj-1" });

      const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as { query: string };
      expect(call.query).toContain("__internal__%__suite");
    });
  });

  describe("cursor roundtrip", () => {
    it("encodes and decodes correctly through pagination", async () => {
      // Page 1: returns 2 batch IDs + 1 extra (hasMore)
      setQueryResults(clickhouse, [
        [
          { BatchRunId: "batch-a", MaxCreatedAt: "5000" },
          { BatchRunId: "batch-b", MaxCreatedAt: "4000" },
        ],
        [makeRunRow({ BatchRunId: "batch-a" })],
      ]);

      const page1 = await service.getRunDataForScenarioSet({
        projectId: "proj-1",
        scenarioSetId: "set-1",
        limit: 1,
      });

      expect(page1.nextCursor).toBeDefined();

      // Decode to verify structure
      const decoded = JSON.parse(
        Buffer.from(page1.nextCursor!, "base64").toString("utf-8"),
      );
      expect(decoded).toEqual({ ts: "5000", batchRunId: "batch-a" });
    });
  });
});
