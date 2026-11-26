/**
 * Filter values a query cannot apply are refused by the translators instead of widening to
 * no predicate. The service refuses the same values first; this covers a direct builder call.
 * @see specs/analytics/filter-value-validation.feature
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";

import { translateAllFilters, resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const dates = {
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
};

describe("analytics filter translation", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("given a timeseries request filtering traces with an error", () => {
    /** @scenario "Filtering to traces that contain an error narrows the query" */
    it("counts only traces that contain an error", () => {
      expect(translateAllFilters({ "traces.error": ["true"] }).whereClause).toBe(
        "(ts.ContainsErrorStatus = 1)",
      );
    });
  });

  describe("given a timeseries request asking for traces with and without an error", () => {
    /** @scenario "Asking for both error states filters nothing" */
    it("counts every trace", () => {
      expect(translateAllFilters({ "traces.error": ["true", "false"] }).whereClause).toBe("1=1");
    });
  });

  describe("given an error filter carrying the option label", () => {
    /** @scenario "An option label sent as a boolean filter value is refused" */
    it("refuses naming the filter, the value received and the values it accepts", () => {
      expect(() => translateAllFilters({ "traces.error": ["Traces with error"] })).toThrow(
        expect.objectContaining({
          code: "analytics_filter_value_unsupported",
          httpStatus: 422,
          meta: expect.objectContaining({
            field: "filters.traces.error",
            received: "Traces with error",
            accepted: ["true", "false"],
          }),
        }),
      );
    });

    it("refuses on the slim trace_analytics builder too", () => {
      expect(() =>
        buildSlimTimeseriesQuery({
          projectId: "tenant-slim",
          ...dates,
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          timeScale: "full",
          filters: { "traces.error": ["Traces without error"] },
        }),
      ).toThrow(expect.objectContaining({ code: "analytics_filter_value_unsupported" }));
    });
  });

  describe("given an annotation or evaluation pass filter carrying an option label", () => {
    /** @scenario "The annotation and evaluation pass filters refuse a label the same way" */
    it.each([
      { "annotations.hasAnnotation": ["Has Annotation"] },
      { "evaluations.passed": { "monitor-1": ["Passed"] } },
      { "evaluations.passed": ["Failed"] },
    ])("refuses %j", (filters) => {
      expect(() => translateAllFilters(filters)).toThrow(
        expect.objectContaining({ code: "analytics_filter_value_unsupported" }),
      );
    });
  });

  describe("given a metadata value filter sent as a plain list", () => {
    /** @scenario "A metadata value filter sent without its metadata key is refused" */
    it("refuses with an example of the nested shape", () => {
      expect(() => translateAllFilters({ "metadata.value": ["production"] })).toThrow(
        expect.objectContaining({
          code: "analytics_filter_key_required",
          meta: expect.objectContaining({
            field: "filters.metadata.value",
            example: '{"metadata.value":{"<metadataKey>":["<value>"]}}',
          }),
        }),
      );
    });

    it("still applies the filter under its key", () => {
      expect(
        translateAllFilters({ "metadata.value": { environment: ["production"] } }).whereClause,
      ).toContain("Attributes[");
    });
  });

  describe("given an event metric value filter keyed only by event type", () => {
    /** @scenario "An event metric value filter sent without its metric key is refused" */
    it("refuses because no metric is named", () => {
      expect(() =>
        translateAllFilters({ "events.metrics.value": { thumbs_up_down: ["0", "1"] } }),
      ).toThrow(expect.objectContaining({ code: "analytics_filter_key_required" }));
    });

    it("still applies the filter under event type and metric key", () => {
      expect(
        translateAllFilters({ "events.metrics.value": { thumbs_up_down: { vote: ["0", "1"] } } })
          .whereClause,
      ).toContain("toFloat64OrNull");
    });
  });

  describe("given an evaluation pass filter sent as a plain list", () => {
    /** @scenario "An evaluation pass filter without an evaluator still reads across every evaluator" */
    it("builds the filter across every evaluator", () => {
      const { whereClause } = translateAllFilters({ "evaluations.passed": ["true"] });

      expect(whereClause).toContain("Passed IN");
      expect(whereClause).not.toContain("EvaluatorId");
    });
  });
});
