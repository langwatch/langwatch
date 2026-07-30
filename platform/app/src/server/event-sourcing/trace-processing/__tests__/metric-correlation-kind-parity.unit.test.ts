import { describe, expect, it } from "vitest";
import { metricKindSchema } from "../../metric-processing/schema";
import { metricCorrelationSchema } from "../schema";

/**
 * `metricCorrelationSchema` restates `metric-processing`'s kinds instead of
 * importing them, because `trace-processing/schema` is reachable from the
 * client and must stay a leaf on `zod`. Restating is what let the two drift:
 * the correlation copy read `counter | gauge | histogram | summary`, so a
 * correlation for a `sum` or `exponential_histogram` point — the two kinds
 * OTLP sends most — was rejected at the boundary rather than stored.
 */
describe("given the metric-correlation bridge restates the metric kinds", () => {
  describe("when compared with the pipeline it bridges from", () => {
    it("accepts exactly the kinds metric-processing emits", () => {
      const bridged = metricCorrelationSchema.shape.metricKind.options;

      expect([...bridged].sort()).toEqual([...metricKindSchema.options].sort());
    });

    it("accepts a sum point, which the drifted copy rejected", () => {
      expect(() =>
        metricCorrelationSchema.shape.metricKind.parse("sum"),
      ).not.toThrow();
    });

    it("accepts an exponential histogram point, which the drifted copy rejected", () => {
      expect(() =>
        metricCorrelationSchema.shape.metricKind.parse("exponential_histogram"),
      ).not.toThrow();
    });
  });
});
