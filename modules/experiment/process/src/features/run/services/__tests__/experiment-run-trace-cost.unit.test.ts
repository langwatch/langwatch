/** @see modules/experiment/specs/experiment-run-trace-cost.feature */
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi, TraceCost } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ExperimentRunTraceCostService } from "../experiment-run-trace-cost.service.ts";

type CostQuery = Parameters<TraceApi["findTraceCosts"]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;
const CREATED_AT = Date.UTC(2026, 9, 1, 12);
const UPDATED_AT = Date.UTC(2026, 9, 1, 13);

function runWith(dataset: ExperimentRunWithItems["dataset"]): ExperimentRunWithItems {
  return {
    experimentId: "experiment_1",
    runId: "run_1",
    projectId: "project_1",
    dataset,
    evaluations: [],
    timestamps: { createdAt: CREATED_AT, updatedAt: UPDATED_AT },
    completeness: {
      complete: true,
      dataset: { received: dataset.length, expected: null },
      evaluations: { received: 0, expected: null },
    },
  };
}

function row(index: number, cost: number | null, traceId = "trace_1") {
  return { index, entry: {}, cost, traceId };
}

/** A pricing service over a trace read that answers `costs`, or throws when given an error. */
function pricing(costs: TraceCost[] | Error) {
  const queries: CostQuery[] = [];
  const service = ExperimentRunTraceCostService.create({
    traces: createApiFixture<Pick<TraceApi, "findTraceCosts">>({
      findTraceCosts: async (query) => {
        queries.push(query);
        if (costs instanceof Error) throw costs;
        return costs;
      },
    }),
  });
  return { service, queries };
}

describe("ExperimentRunTraceCostService.priceRows", () => {
  describe("when a target row recorded no cost and its trace cost 0.3", () => {
    /** @scenario "A target row that recorded no cost takes its trace's cost" */
    it("prices the row at the trace's cost", async () => {
      const { service } = pricing([{ traceId: "trace_1", totalCost: 0.3 }]);

      const run = await service.priceRows(runWith([row(0, null)]));

      expect(run.dataset[0]?.cost).toBe(0.3);
    });
  });

  describe("when three unpriced rows share a trace that cost 0.3", () => {
    /** @scenario "Rows sharing one trace split its cost evenly" */
    it("splits the cost evenly across them", async () => {
      const { service } = pricing([{ traceId: "trace_1", totalCost: 0.3 }]);

      const run = await service.priceRows(runWith([row(0, null), row(1, null), row(2, null)]));

      expect(run.dataset.map((entry) => entry.cost)).toEqual([0.1, 0.1, 0.1]);
    });
  });

  describe("when the row recorded its own cost", () => {
    /** @scenario "A row that recorded its own cost keeps it" */
    it("keeps the recorded cost without asking trace", async () => {
      const { service, queries } = pricing([{ traceId: "trace_1", totalCost: 0.3 }]);

      const run = await service.priceRows(runWith([row(0, 0.5)]));

      expect(run.dataset[0]?.cost).toBe(0.5);
      expect(queries).toHaveLength(0);
    });
  });

  describe("when the trace has no positive cost", () => {
    /** @scenario "A trace without a positive cost leaves the row unpriced" */
    it("leaves the row's cost empty", async () => {
      const { service } = pricing([{ traceId: "trace_1", totalCost: 0 }]);

      const run = await service.priceRows(runWith([row(0, null)]));

      expect(run.dataset[0]?.cost).toBeNull();
    });
  });

  describe("when trace's cost read fails", () => {
    /** @scenario "A failed trace read leaves the rows unpriced" */
    it("returns the run with the row still unpriced", async () => {
      const { service } = pricing(new Error("ClickHouse unavailable"));

      const run = await service.priceRows(runWith([row(0, null)]));

      expect(run.dataset[0]?.cost).toBeNull();
    });
  });

  describe("when the run has an unpriced row", () => {
    /** @scenario "Trace's cost read asks only within a day of the run's first and last write" */
    it("asks trace from a day before creation to a day after the last update", async () => {
      const { service, queries } = pricing([]);

      await service.priceRows(runWith([row(0, null)]));

      expect(queries).toEqual([
        {
          projectId: "project_1",
          traceIds: ["trace_1"],
          occurredAt: { from: CREATED_AT - DAY_MS, to: UPDATED_AT + DAY_MS },
        },
      ]);
    });
  });
});
