// Reading graph trigger series; distinguish cardinality overflow (SKIPPED) from
// real failures (propagate) to avoid hiding outages.

import { SeriesPercentageUnsupportedError } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { GraphTriggerSeriesEvaluationService } from "../graph-trigger-series-evaluation.service.ts";

function planThatFailsWith(error: unknown) {
  const logged: Record<string, unknown>[] = [];
  const plan = {
    request: {
      triggerId: "trigger-1",
      projectId: "project-1",
      reason: "scheduled",
      deps: {
        analytics: {
          getTimeseries: async () => {
            throw error;
          },
        },
        logger: {
          error: (fields: Record<string, unknown>) => {
            logged.push(fields);
          },
        },
      },
    },
    graph: {},
    series: { metric: "metadata.trace_id", aggregation: "cardinality" },
    seriesName: "0/metadata.trace_id/cardinality",
    timePeriod: 60,
    timeseriesInput: { series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }] },
  };

  return {
    logged,
    evaluate: () => GraphTriggerSeriesEvaluationService.create().evaluate(plan as never),
  };
}

const tooLarge = "timeseries result exceeds the row ceiling";

describe("GraphTriggerSeriesEvaluationService.evaluate", () => {
  describe("given analytics refuses the read as too large", () => {
    it("skips the evaluation with a reason, rather than failing the trigger", async () => {
      const { evaluate } = planThatFailsWith(Object.assign(new Error("too big"), { code: 396 }));

      await expect(evaluate()).resolves.toMatchObject({
        status: "skipped",
        detail: tooLarge,
        triggerId: "trigger-1",
        projectId: "project-1",
      });
    });

    it("recognises the code however the client spelled it", async () => {
      // One ClickHouse client hands back a number, another the same code as a
      // string. Matching only one would let the other through as a crash.
      const { evaluate } = planThatFailsWith(Object.assign(new Error("too big"), { code: "396" }));

      await expect(evaluate()).resolves.toMatchObject({ status: "skipped", detail: tooLarge });
    });

    it("recognises it from the message when no code came with it", async () => {
      const { evaluate } = planThatFailsWith(new Error("DB::Exception: TOO_MANY_ROWS_OR_BYTES"));

      await expect(evaluate()).resolves.toMatchObject({ status: "skipped", detail: tooLarge });
    });

    it("records what was being read, so the graph can be narrowed", async () => {
      const { evaluate, logged } = planThatFailsWith(
        Object.assign(new Error("too big"), { code: 396 }),
      );

      await evaluate();

      expect(logged[0]).toMatchObject({
        triggerId: "trigger-1",
        projectId: "project-1",
        timePeriodMinutes: 60,
      });
    });
  });

  describe("given the query builder refuses the series as a percentage", () => {
    /** @scenario "An alert on a series the query refuses is skipped, not retried forever" */
    it("skips that trigger instead of failing the evaluation", async () => {
      const { evaluate } = planThatFailsWith(new SeriesPercentageUnsupportedError());

      await expect(evaluate()).resolves.toMatchObject({
        status: "skipped",
        detail: "series cannot be shown as a percentage",
      });
    });

    it("names the series in the log, so the author knows which one to edit", async () => {
      const { evaluate, logged } = planThatFailsWith(new SeriesPercentageUnsupportedError());

      await evaluate();

      expect(logged[0]).toMatchObject({
        triggerId: "trigger-1",
        seriesMetric: "metadata.trace_id",
        seriesAggregation: "cardinality",
      });
    });
  });

  describe("given analytics failed for any other reason", () => {
    it("lets the failure through, rather than reporting a skip", async () => {
      // Swallowing this would stop the trigger alerting and say nothing.
      const { evaluate } = planThatFailsWith(new Error("connection refused"));

      await expect(evaluate()).rejects.toThrow("connection refused");
    });

    it("does not treat a neighbouring error code as the ceiling", async () => {
      const { evaluate } = planThatFailsWith(Object.assign(new Error("other"), { code: 397 }));

      await expect(evaluate()).rejects.toThrow("other");
    });
  });
});
