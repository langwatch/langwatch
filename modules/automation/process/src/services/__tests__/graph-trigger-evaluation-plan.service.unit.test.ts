import { analyticsTimeseriesInputSchema } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  GraphEvaluationRequest,
  TimeseriesInputType,
} from "../../features/graph-alert/services/graph-trigger-evaluation-plan.service.ts";
import { GraphTriggerEvaluationPlanService } from "../../features/graph-alert/services/graph-trigger-evaluation-plan.service.ts";

const NOW = Temporal.Instant.from("2026-06-20T12:00:00Z");

function requestFor({ groupBy }: { groupBy?: string }): GraphEvaluationRequest {
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
            timeScale: 60,
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
});
