import { describe, expect, it } from "vitest";
import {
  analyticsMetrics,
  flattenAnalyticsMetricsEnum,
  getMetric,
  seriesInput,
} from "../registry";
import { allAggregationTypes } from "../types";

describe("analyticsMetrics", () => {
  describe("evaluation_pass_rate", () => {
    /** @scenario "Evaluation pass rate displays as percentage" */
    it("uses percentage format", () => {
      expect(analyticsMetrics.evaluations.evaluation_pass_rate.format).toBe(
        "0%",
      );
    });
  });
});

describe("seriesInput allowedAggregations enforcement", () => {
  /** @scenario "A metric paired with an aggregation outside its allowed set is rejected" */
  it("rejects every pairing the registry does not allow", () => {
    // The production instance was a ["cardinality"]-only metric paired with
    // "sum"; make sure the registry still contains that class so the sweep
    // below cannot go vacuous if metrics are later loosened.
    const cardinalityOnly = flattenAnalyticsMetricsEnum.filter((metric) => {
      const allowed = getMetric(metric).allowedAggregations;
      return allowed.length === 1 && allowed[0] === "cardinality";
    });
    expect(cardinalityOnly.length).toBeGreaterThan(0);

    let rejectedPairings = 0;
    for (const metric of flattenAnalyticsMetricsEnum) {
      const allowed = getMetric(metric).allowedAggregations;
      for (const aggregation of allAggregationTypes) {
        if (allowed.includes(aggregation)) continue;
        // The query layer executes `terms` as `cardinality`, so the schema
        // accepts the alias wherever cardinality is allowed.
        if (aggregation === "terms" && allowed.includes("cardinality")) {
          continue;
        }
        const result = seriesInput.safeParse({ metric, aggregation });
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues[0]!;
          expect(issue.path).toEqual(["aggregation"]);
          expect(issue.message).toContain(metric);
          expect(issue.message).toContain(aggregation);
          for (const allowedAggregation of allowed) {
            expect(issue.message).toContain(allowedAggregation);
          }
        }
        rejectedPairings++;
      }
    }
    expect(rejectedPairings).toBeGreaterThan(0);
  });

  /** @scenario "Every aggregation a metric allows still validates" */
  it("accepts every pairing the registry allows", () => {
    for (const metric of flattenAnalyticsMetricsEnum) {
      for (const aggregation of getMetric(metric).allowedAggregations) {
        const result = seriesInput.safeParse({ metric, aggregation });
        expect(result.success).toBe(true);
      }
    }
  });

  /** @scenario "The legacy terms alias keeps validating wherever cardinality is allowed" */
  it("accepts terms on a cardinality-only metric (pre-rename stored graphs)", () => {
    const cardinalityOnly = flattenAnalyticsMetricsEnum.filter((metric) => {
      const allowed = getMetric(metric).allowedAggregations;
      return allowed.length === 1 && allowed[0] === "cardinality";
    });
    expect(cardinalityOnly.length).toBeGreaterThan(0);
    for (const metric of cardinalityOnly) {
      const result = seriesInput.safeParse({ metric, aggregation: "terms" });
      expect(result.success).toBe(true);
    }
  });
});
