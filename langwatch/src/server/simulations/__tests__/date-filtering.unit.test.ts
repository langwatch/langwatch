import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseSimulationService } from "../clickhouse-simulation.service";

function makeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test",
    "Messages.Id": [] as string[],
    "Messages.Role": [] as string[],
    "Messages.Content": [] as string[],
    "Messages.TraceId": [] as string[],
    "Messages.Rest": [] as string[],
    TraceIds: [] as string[],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: [] as string[],
    UnmetCriteria: [] as string[],
    Error: null,
    DurationMs: "1500",
    CreatedAt: "1000",
    UpdatedAt: "2500",
    FinishedAt: "2500",
    DeletedAt: null,
    ...overrides,
  };
}

function createMockClickHouse() {
  const jsonFn = vi.fn().mockResolvedValue([]);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn, command: vi.fn() } as unknown as ClickHouseClient;
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

describe("ClickHouseSimulationService date filtering", () => {
  let clickhouse: ClickHouseClient;
  let service: ClickHouseSimulationService;

  beforeEach(() => {
    clickhouse = createMockClickHouse();
    service = new ClickHouseSimulationService(clickhouse);
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when startDate and endDate are provided", () => {
      it("includes date range parameters in the query", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForAllSuites({
          projectId: "proj-1",
          startDate: 1700000000000,
          endDate: 1700100000000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query: string; query_params: Record<string, string> };

        expect(call.query_params.startDateMs).toBe("1700000000000");
        expect(call.query_params.endDateMs).toBe("1700100000000");
      });

      it("includes HAVING clause with date bounds", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForAllSuites({
          projectId: "proj-1",
          startDate: 1700000000000,
          endDate: 1700100000000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query: string };

        expect(call.query).toContain("startDateMs");
        expect(call.query).toContain("endDateMs");
      });
    });

    describe("when no dates are provided", () => {
      it("does not include date parameters in the query", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForAllSuites({
          projectId: "proj-1",
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query_params: Record<string, string> };

        expect(call.query_params.startDateMs).toBeUndefined();
        expect(call.query_params.endDateMs).toBeUndefined();
      });
    });

    describe("when only startDate is provided", () => {
      it("includes only the start date parameter", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForAllSuites({
          projectId: "proj-1",
          startDate: 1700000000000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query_params: Record<string, string> };

        expect(call.query_params.startDateMs).toBe("1700000000000");
        expect(call.query_params.endDateMs).toBeUndefined();
      });
    });
  });

  describe("getRunDataForScenarioSet()", () => {
    describe("when startDate and endDate are provided", () => {
      it("includes date range parameters in the query", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
          startDate: 1700000000000,
          endDate: 1700100000000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query_params: Record<string, string> };

        expect(call.query_params.startDateMs).toBe("1700000000000");
        expect(call.query_params.endDateMs).toBe("1700100000000");
      });
    });

    describe("when no dates are provided", () => {
      it("does not include date parameters in the query", async () => {
        setQueryResults(clickhouse, [[]]);

        await service.getRunDataForScenarioSet({
          projectId: "proj-1",
          scenarioSetId: "set-1",
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query_params: Record<string, string> };

        expect(call.query_params.startDateMs).toBeUndefined();
        expect(call.query_params.endDateMs).toBeUndefined();
      });
    });

    describe("when dates are combined with cursor", () => {
      it("includes both cursor and date parameters", async () => {
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
          startDate: 1700000000000,
          endDate: 1700100000000,
        });

        const call = (clickhouse.query as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as { query_params: Record<string, string> };

        expect(call.query_params.cursorTs).toBe("5000");
        expect(call.query_params.startDateMs).toBe("1700000000000");
        expect(call.query_params.endDateMs).toBe("1700100000000");
      });
    });
  });
});
