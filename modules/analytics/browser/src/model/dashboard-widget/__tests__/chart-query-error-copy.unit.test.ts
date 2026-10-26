/**
 * The words for a chart query failure: the registry's where it has them, and what the executor
 * carried across where it does not, so the reader never sees an empty line after the code.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import type { ChartQueryError } from "@langwatch/analytics-contract/chart-frame-protocol";
import { describe, expect, it } from "vitest";

import { explainChartQueryError } from "../chart-query-error-copy.ts";

describe("explainChartQueryError", () => {
  describe("given the frame refused a query for running too many at once", () => {
    /** @scenario A widget that runs too many queries at once is told why */
    it("says the extra query was not started", () => {
      const copy = explainChartQueryError({
        code: "dashboard_widget_query_overloaded",
        retryable: true,
      });

      expect(copy.description).toMatch(/not started/i);
    });
  });

  describe("given a code the registry has no copy for", () => {
    const carried: Pick<ChartQueryError, "code" | "message" | "traceId"> = {
      code: "lwql_brand_new_refusal",
      message: "Narrow the time range. Then run it again.",
      traceId: "trace-9",
    };

    /** @scenario A failure with a code the registry lacks keeps what the executor said */
    it("shows the sentence the executor carried and the trace id", () => {
      const copy = explainChartQueryError(carried);

      expect(copy.description).toBe("Narrow the time range. Then run it again.");
      expect(copy.traceId).toBe("trace-9");
    });
  });

  describe("given a failure with no code", () => {
    /** @scenario A failure with a code the registry lacks keeps what the executor said */
    it("shows the sentence the executor carried instead of the generic line", () => {
      const copy = explainChartQueryError({
        code: "unknown",
        message: "The query could not be run. Check the page's log panel.",
        traceId: "trace-3",
      });

      expect(copy.description).toBe("The query could not be run. Check the page's log panel.");
      expect(copy.traceId).toBe("trace-3");
    });
  });

  describe("given a registered code that also carries a message", () => {
    it("words it from the registry, not from the carried prose", () => {
      const copy = explainChartQueryError({
        code: "dashboard_widget_query_not_found",
        meta: { queryName: "cost" },
        message: "SOMETHING THE FRAME WROTE",
      });

      expect(copy.description).toContain('"cost"');
      expect(copy.description).not.toContain("FRAME WROTE");
    });
  });
});
