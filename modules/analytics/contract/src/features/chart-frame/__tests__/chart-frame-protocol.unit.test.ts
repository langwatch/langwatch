/**
 * The one mapping from the server's result to what crosses the frame's port: the completeness
 * report rides along when the server sent one, and only its contract fields cross.
 * @see modules/analytics/specs/dashboard-widget-gaps.feature
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLQueryResult } from "../../lwql/analytics.lwql.ts";
import { readChartAsk, readChartSignal, toChartQueryResult } from "../chart-frame-protocol.ts";

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

describe("readChartAsk", () => {
  /** @scenario "AC245 Chart asks: a click says what kind of value was clicked, its raw value and the bucket it starts" */
  it("keeps the kind, label, raw value, ISO bucket and series, trimmed and cut", () => {
    expect(
      readChartAsk({
        kind: " day ",
        label: "Nov 3",
        at: "2026-11-03T00:00:00.000Z",
        series: "Errors",
        extra: "dropped",
      }),
    ).toEqual({
      kind: "subject",
      subject: { kind: "day", label: "Nov 3", at: "2026-11-03T00:00:00.000Z", series: "Errors" },
    });
    expect(readChartAsk({ kind: "model", label: "gpt-5", value: 5 })).toEqual({
      kind: "subject",
      subject: { kind: "model", label: "gpt-5", value: "5" },
    });
    expect(readChartAsk({ kind: "k".repeat(60), label: "x" })).toEqual({
      kind: "subject",
      subject: { kind: "k".repeat(40), label: "x" },
    });
  });

  /** @scenario "AC245 Chart asks: a click says what kind of value was clicked, its raw value and the bucket it starts" */
  it("drops a bucket that is no instant, a value equal to the label and a nameless ask", () => {
    expect(readChartAsk({ label: "gpt-5", value: "gpt-5", at: "Nov 3" })).toEqual({
      kind: "subject",
      subject: { label: "gpt-5" },
    });
    expect(readChartAsk({ label: " " })).toEqual({ kind: "nameless" });
    expect(readChartAsk("gpt-5")).toEqual({ kind: "nameless" });
  });
});

describe("readChartSignal", () => {
  /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
  it("reads a boolean problem and drops anything else", () => {
    expect(readChartSignal({ problem: true })).toEqual({
      kind: "signal",
      signal: { problem: true },
    });
    expect(readChartSignal({ problem: false, extra: 1 })).toEqual({
      kind: "signal",
      signal: { problem: false },
    });
    expect(readChartSignal({ problem: "yes" })).toEqual({ kind: "malformed" });
    expect(readChartSignal(undefined)).toEqual({ kind: "malformed" });
  });
});
