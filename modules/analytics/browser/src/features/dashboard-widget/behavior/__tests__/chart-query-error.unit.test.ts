/**
 * What the executor hands the chart frame when a query throws: the registry's words, plus the
 * remediation and error id the server attached for a code the registry cannot word yet.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import { describe, expect, it } from "vitest";

import { toChartQueryError } from "../use-dashboard-widget-executor.ts";

const handledFailure = (payload: Record<string, unknown>) => ({
  data: { error: { httpStatus: 422, ...payload } },
});

describe("toChartQueryError", () => {
  describe("given a handled failure with a code this client has no copy for", () => {
    /** @scenario A failure with a code the registry lacks keeps what the executor said */
    it("carries the first tip as the sentence and the trace id", () => {
      const error = toChartQueryError(
        handledFailure({
          code: "lwql_brand_new_refusal",
          tips: ["Narrow the time range."],
          traceId: "trace-9",
        }),
      );

      expect(error.code).toBe("lwql_brand_new_refusal");
      expect(error.message).toContain("Narrow the time range.");
      expect(error.traceId).toBe("trace-9");
    });
  });
});
