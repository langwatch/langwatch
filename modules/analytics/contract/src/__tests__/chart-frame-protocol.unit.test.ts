/**
 * The one mapping from the server's result to what crosses the frame's port: the completeness
 * report rides along when the server sent one, and only its contract fields cross.
 * @see modules/analytics/specs/dashboard-widget-gaps.feature
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLQueryResult } from "../analytics.lwql.ts";
import { toChartQueryResult } from "../chart-frame-protocol.ts";

const RESULT: LangWatchQLQueryResult = {
  columns: [{ name: "cost", type: "Nullable(Float64)" }],
  rows: [{ cost: null }],
  statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1, rowsReturned: 1 },
  diagnostics: [],
  followsTimeWindow: true,
  followsGranularity: true,
  granularitySeconds: 86_400,
};

describe("toChartQueryResult", () => {
  describe("given a result with a completeness report", () => {
    /** @scenario "The widget's query result carries completeness to the frame" */
    it("carries the report as a plain copy", () => {
      const completeness = {
        state: "partial" as const,
        unit: "traces",
        total: 10,
        fields: [{ field: "TotalCost", label: "total cost", present: 4 }],
        buckets: [{ start: "2026-10-07T00:00:00Z", n: 10 }],
        unpriced: { count: 6, models: ["my-finetune-v2"] },
      };

      const wire = toChartQueryResult({ ...RESULT, completeness });

      expect(wire.completeness).toEqual(completeness);
      expect(wire.completeness).not.toBe(completeness);
      expect(wire.rows).toEqual([{ cost: null }]);
    });
  });

  describe("given a result without one", () => {
    /** @scenario "The widget's query result carries completeness to the frame" */
    it("leaves the field out", () => {
      expect(toChartQueryResult(RESULT)).not.toHaveProperty("completeness");
    });
  });
});
