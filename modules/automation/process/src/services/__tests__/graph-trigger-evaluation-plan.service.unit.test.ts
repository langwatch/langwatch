import { analyticsTimeseriesInputSchema } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  GraphEvaluationRequest,
  TimeseriesInputType,
} from "../../features/graph-alert/services/graph-trigger-evaluation-plan.service.ts";
import { GraphTriggerEvaluationPlanService } from "../../features/graph-alert/services/graph-trigger-evaluation-plan.service.ts";

const NOW = Temporal.Instant.from("2026-06-20T12:00:00Z");

function requestFor({
  groupBy,
  timeScale = 60,
}: {
  groupBy?: string;
  timeScale?: unknown;
}): GraphEvaluationRequest {
  return {
    triggerId: "trigger-1",
    projectId: "project-1",
    reason: "scheduled",
    deps: {
      triggers: {
        findById: async () => ({
          id: "trigger-1",
          active: true,
          customGraphId: "graph-1",
          actionParams: {
            threshold: 250,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/performance.completion_time/avg",
          },
        }),
      },
      customGraphs: {
        findById: async () => ({
          id: "graph-1",
          filters: {},
          graph: {
            series: [
              {
                name: "Average completion time",
                colorSet: "blueTones",
                metric: "performance.completion_time",
                aggregation: "avg",
              },
            ],
            groupBy,
            timeScale,
          },
        }),
      },
      clock: { now: () => NOW },
    },
  } as never;
}

describe("GraphTriggerEvaluationPlanService.createPlan", () => {
  describe("given a grouped graph whose series is an average", () => {
    it("reads the series ungrouped, so the database averages across every group", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(
        requestFor({ groupBy: "traces.trace_name" }),
      );

      const input = (plan as { timeseriesInput: TimeseriesInputType }).timeseriesInput;
      expect(input.groupBy).toBeUndefined();
      expect(input.series).toHaveLength(1);
    });
  });

  describe("given a saved series carrying its display name and colour set", () => {
    /** @scenario "A graph alert queries its series without the chart's display fields" */
    it("asks analytics with only the query fields, which its input schema accepts", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(requestFor({}));

      const input = (plan as { timeseriesInput: TimeseriesInputType }).timeseriesInput;
      expect(input.series[0]).toEqual({
        metric: "performance.completion_time",
        aggregation: "avg",
      });
      expect(analyticsTimeseriesInputSchema.validate(input)).toBe(true);
    });
  });

  describe("given a saved chart whose time scale was stored as text", () => {
    /** @scenario "A graph alert on a chart that stored its time scale as text still evaluates" */
    it("queries with the number of minutes the text names", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(
        requestFor({ timeScale: "60" }),
      );

      const input = (plan as { timeseriesInput: TimeseriesInputType }).timeseriesInput;
      expect(input.timeScale).toBe(60);
      expect(analyticsTimeseriesInputSchema.validate(input)).toBe(true);
    });

    /** @scenario "A graph alert on a chart that stored its time scale as text still evaluates" */
    it("keeps a stored full period", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(
        requestFor({ timeScale: "full" }),
      );

      expect((plan as { timeseriesInput: TimeseriesInputType }).timeseriesInput.timeScale).toBe(
        "full",
      );
    });
  });

  describe("given a saved chart whose stored time scale is null", () => {
    /** @scenario "A graph alert on a chart saved without a time scale queries hourly" */
    it("queries with a 60-minute bucket", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(
        requestFor({ timeScale: null }),
      );

      expect((plan as { timeseriesInput: TimeseriesInputType }).timeseriesInput.timeScale).toBe(60);
    });
  });

  describe("given a saved chart whose time scale is unreadable", () => {
    /** @scenario "A graph alert on a chart with an unreadable time scale is skipped as incomplete" */
    it("skips the evaluation as an incomplete configuration", async () => {
      const plan = await GraphTriggerEvaluationPlanService.create().createPlan(
        requestFor({ timeScale: "hourly" }),
      );

      expect(plan).toMatchObject({
        status: "skipped",
        skipCode: "incomplete_configuration",
        triggerId: "trigger-1",
      });
      expect(plan).not.toHaveProperty("timeseriesInput");
    });
  });
});
