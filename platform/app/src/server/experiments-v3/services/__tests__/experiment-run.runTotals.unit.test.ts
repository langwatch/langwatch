/**
 * The run's totals are derived the same way its items are (ADR-072, retired;
 * ground now ADR-103).
 *
 * `getRun` prices a cost-less target item from the trace it produced, so the
 * dataset table shows a figure per row. The run total the footer adds up comes
 * from a different read — `enrichRunsWithBreakdownAndCosts` — and used to be a
 * bare `sumIf(TargetCost, …)` over the raw item rows. An SDK experiment reports
 * no inline cost, so every row showed a price under a zero total.
 *
 * These tests drive both reads through a stubbed ClickHouse client so the two
 * derivations can be compared without a container. The stub answers by query
 * shape; an unrecognised query fails loudly rather than returning `[]`, which
 * would let a silently-dropped query pass as "no cost".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClickHouseClientForProjectMock = vi.fn();
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: (...args: unknown[]) =>
    getClickHouseClientForProjectMock(...args),
}));

import { ExperimentRunService } from "../experiment-run.service";

const PROJECT_ID = "project-1";
const EXPERIMENT_ID = "exp-1";
const RUN_ID = "run-1";

interface StubTables {
  runs: Record<string, unknown>[];
  breakdown: Record<string, unknown>[];
  costs: Record<string, unknown>[];
  items: Record<string, unknown>[];
  traceGroups: Record<string, unknown>[];
  traceCosts: Record<string, unknown>[];
}

/**
 * Routes a query to a canned result by the shape of its SELECT list. Keyed on
 * the aliases the read path itself defines, so a renamed alias surfaces as an
 * unrouted query rather than a silently empty answer.
 */
function routeQuery(
  sql: string,
  tables: StubTables,
): Record<string, unknown>[] {
  if (sql.includes("FROM trace_summaries")) return tables.traceCosts;
  if (sql.includes("AS costlessCount")) return tables.traceGroups;
  if (sql.includes("AS datasetCost")) return tables.costs;
  if (sql.includes("AS avgScore")) return tables.breakdown;
  if (sql.includes("FROM experiment_run_items")) return tables.items;
  if (sql.includes("FROM experiment_runs")) return tables.runs;
  throw new Error(`stub ClickHouse client got an unrouted query:\n${sql}`);
}

function stubClickHouse(tables: StubTables) {
  const client = {
    query: vi.fn(async ({ query }: { query: string }) => ({
      json: async () => routeQuery(query, tables),
    })),
  };
  getClickHouseClientForProjectMock.mockResolvedValue(client);
  return client;
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: "proj-1",
    TenantId: PROJECT_ID,
    RunId: RUN_ID,
    ExperimentId: EXPERIMENT_ID,
    WorkflowVersionId: null,
    Version: "2025-02-01",
    Total: 2,
    Progress: 2,
    CompletedCount: 2,
    FailedCount: 0,
    TotalDurationMs: null,
    AvgScoreBps: null,
    PassRateBps: null,
    Targets: "[]",
    CreatedAt: "2024-01-15 10:30:00.000",
    UpdatedAt: "2024-01-15 10:35:00.000",
    FinishedAt: null,
    StoppedAt: null,
    ...overrides,
  };
}

/**
 * The per-run aggregate row. `datasetCost` is null exactly as ClickHouse
 * returns it when every `TargetCost` in the run is NULL — the SDK case.
 */
function costRow(overrides: Record<string, unknown> = {}) {
  return {
    ExperimentId: EXPERIMENT_ID,
    RunId: RUN_ID,
    datasetCost: null,
    evaluationsCost: null,
    datasetAverageCost: null,
    datasetAverageDuration: null,
    evaluationsAverageCost: null,
    evaluationsAverageDuration: null,
    datasetPricedCount: 0,
    tracedCostlessCount: 2,
    ...overrides,
  };
}

function traceGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    ExperimentId: EXPERIMENT_ID,
    RunId: RUN_ID,
    TraceId: "trace-1",
    targetCount: 1,
    costlessCount: 1,
    ...overrides,
  };
}

function targetItemRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: "item-1",
    TenantId: PROJECT_ID,
    RunId: RUN_ID,
    ExperimentId: EXPERIMENT_ID,
    RowIndex: 0,
    TargetId: "target-a",
    ResultType: "target",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TargetDomainError: null,
    TraceId: "trace-1",
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    CreatedAt: "2024-01-15 10:31:00.000",
    ...overrides,
  };
}

function emptyTables(): StubTables {
  return {
    runs: [],
    breakdown: [],
    costs: [],
    items: [],
    traceGroups: [],
    traceCosts: [],
  };
}

function makeService() {
  return new ExperimentRunService({} as any);
}

async function readRunSummary() {
  const byExperiment = await makeService().listRuns({
    projectId: PROJECT_ID,
    experimentIds: [EXPERIMENT_ID],
  });
  return byExperiment[EXPERIMENT_ID]![0]!.summary;
}

describe("experiment run totals", () => {
  beforeEach(() => {
    getClickHouseClientForProjectMock.mockReset();
  });

  describe("given a run whose items were recorded without costs", () => {
    describe("when the run list is read", () => {
      /** @scenario Several targets sharing one trace split its cost */
      it("reports the price of the traces those items produced", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow()],
          costs: [costRow()],
          traceGroups: [
            traceGroupRow({ TraceId: "trace-1" }),
            traceGroupRow({ TraceId: "trace-2" }),
          ],
          traceCosts: [
            { TraceId: "trace-1", TotalCost: 0.02 },
            { TraceId: "trace-2", TotalCost: 0.03 },
          ],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeCloseTo(0.05, 8);
      });
    });
  });

  describe("given two targets whose executions share one trace", () => {
    describe("when the run list is read", () => {
      /** @scenario Several targets sharing one trace split its cost */
      it("counts that trace's cost once rather than once per target", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow()],
          costs: [costRow()],
          traceGroups: [traceGroupRow({ targetCount: 2, costlessCount: 2 })],
          traceCosts: [{ TraceId: "trace-1", TotalCost: 0.02 }],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeCloseTo(0.02, 8);
      });
    });

    describe("when the run itself is read", () => {
      /** @scenario Several targets sharing one trace split its cost */
      it("divides that trace's cost evenly between them", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow()],
          items: [
            targetItemRow({ ProjectionId: "item-a", TargetId: "target-a" }),
            targetItemRow({
              ProjectionId: "item-b",
              TargetId: "target-b",
              RowIndex: 0,
            }),
          ],
          traceCosts: [{ TraceId: "trace-1", TotalCost: 0.02 }],
        });

        const run = await makeService().getRun({
          projectId: PROJECT_ID,
          experimentId: EXPERIMENT_ID,
          runId: RUN_ID,
        });

        expect(run!.dataset.map((d) => d.cost)).toEqual([0.01, 0.01]);
      });
    });
  });

  describe("given a run already reported as finished", () => {
    describe("when one of its traces is priced afterwards", () => {
      /** @scenario A trace priced after the run finished is still counted */
      it("still counts that trace's cost in the run's total", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow({ FinishedAt: "2024-01-15 10:36:00.000" })],
          costs: [costRow({ tracedCostlessCount: 1 })],
          traceGroups: [traceGroupRow()],
          traceCosts: [{ TraceId: "trace-1", TotalCost: 0.07 }],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeCloseTo(0.07, 8);
      });
    });
  });

  describe("given a run whose trace has been priced", () => {
    describe("when further spans arrive and the trace is repriced higher", () => {
      /** @scenario A trace repriced upwards reports the newer figure */
      it("reports the newer figure, and the same figure on every later read", async () => {
        const tables: StubTables = {
          ...emptyTables(),
          runs: [runRow()],
          costs: [costRow({ tracedCostlessCount: 1 })],
          traceGroups: [traceGroupRow()],
          traceCosts: [{ TraceId: "trace-1", TotalCost: 0.1 }],
        };
        stubClickHouse(tables);

        const beforeReprice = await readRunSummary();
        expect(beforeReprice.datasetCost).toBeCloseTo(0.1, 8);

        tables.traceCosts = [{ TraceId: "trace-1", TotalCost: 0.25 }];

        const afterReprice = await readRunSummary();
        const readAgain = await readRunSummary();

        expect(afterReprice.datasetCost).toBeCloseTo(0.25, 8);
        expect(readAgain.datasetCost).toBe(afterReprice.datasetCost);
      });
    });
  });

  describe("given a run whose items carry their own costs", () => {
    describe("when the run list is read", () => {
      it("reports those costs without looking a trace price up", async () => {
        const client = stubClickHouse({
          ...emptyTables(),
          runs: [runRow()],
          costs: [
            costRow({
              datasetCost: 0.04,
              evaluationsCost: 0.002,
              datasetPricedCount: 2,
              tracedCostlessCount: 0,
            }),
          ],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeCloseTo(0.04, 8);
        expect(summary.evaluationsCost).toBeCloseTo(0.002, 8);
        const queried = client.query.mock.calls.map(
          ([args]) => (args as { query: string }).query,
        );
        expect(queried.some((q) => q.includes("FROM trace_summaries"))).toBe(
          false,
        );
      });
    });
  });

  describe("given a run whose items are partly priced inline", () => {
    describe("when the run list is read", () => {
      it("averages the trace-priced items in alongside the inline ones", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow({ Total: 2 })],
          costs: [
            costRow({
              datasetCost: 0.02,
              datasetPricedCount: 1,
              tracedCostlessCount: 1,
            }),
          ],
          traceGroups: [traceGroupRow()],
          traceCosts: [{ TraceId: "trace-1", TotalCost: 0.04 }],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeCloseTo(0.06, 8);
        expect(summary.datasetAverageCost).toBeCloseTo(0.03, 8);
      });
    });
  });

  describe("given a run whose items have not been folded yet", () => {
    describe("when the run list is read", () => {
      it("reports no cost rather than a figure carried on the run row", async () => {
        stubClickHouse({
          ...emptyTables(),
          runs: [runRow({ Total: 10 })],
          costs: [],
        });

        const summary = await readRunSummary();

        expect(summary.datasetCost).toBeUndefined();
        expect(summary.evaluationsCost).toBeUndefined();
      });
    });
  });
});
