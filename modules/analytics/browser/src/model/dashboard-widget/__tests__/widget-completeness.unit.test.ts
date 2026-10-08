/**
 * One widget's state from what each of its queries answered: the worst state over the queries
 * with traffic, and the (i)'s notes on partial data.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import type { QueryCompleteness } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  combineCompleteness,
  completenessNotes,
  hasUnpricedCost,
  recordQueryFailure,
  sampleNote,
  recordQueryResult,
  widgetFace,
  type WidgetQueryRecords,
} from "../widget-completeness.ts";

const report = (overrides: Partial<QueryCompleteness>): QueryCompleteness => ({
  state: "complete",
  unit: "traces",
  total: 10,
  fields: [],
  ...overrides,
});

const PARTIAL = report({
  state: "partial",
  total: 1000,
  fields: [{ field: "TotalCost", label: "total cost", present: 400 }],
  unpriced: { count: 600, models: ["my-finetune-v2"] },
});
const MISSING = report({
  state: "missing",
  fields: [{ field: "TopicId", label: "topic", present: 0 }],
});
const NO_TRAFFIC = report({ state: "no_traffic", total: 0 });

describe("combineCompleteness", () => {
  /** @scenario "The worst state over the queries with traffic wins" */
  it("takes the worst state over the queries", () => {
    expect(combineCompleteness([PARTIAL, MISSING])?.state).toBe("missing");
    expect(combineCompleteness([report({}), PARTIAL])?.state).toBe("partial");
  });

  /** @scenario "An empty comparison window does not empty the card" */
  it("ignores a query with no traffic beside one with traffic", () => {
    expect(combineCompleteness([report({}), NO_TRAFFIC])?.state).toBe("complete");
  });

  /** @scenario "An empty comparison window does not empty the card" */
  it("is no traffic only when every query found none", () => {
    expect(combineCompleteness([NO_TRAFFIC, NO_TRAFFIC])?.state).toBe("no_traffic");
  });

  it("is null when no query reported", () => {
    expect(combineCompleteness([])).toBeNull();
  });
});

describe("completenessNotes", () => {
  /** @scenario "The info tip says what is missing and which models have no price" */
  it("names the field's coverage and the models with no price", () => {
    const notes = completenessNotes(combineCompleteness([PARTIAL]));

    expect(notes).toEqual([
      "Total cost on 400 of 1,000 traces.",
      "No price for my-finetune-v2 (600 traces).",
    ]);
    expect(hasUnpricedCost(combineCompleteness([PARTIAL]))).toBe(true);
  });

  it("says nothing unless the data is partial", () => {
    expect(completenessNotes(combineCompleteness([report({})]))).toEqual([]);
    expect(completenessNotes(null)).toEqual([]);
  });
});

describe("widgetFace", () => {
  const BUSY = { code: "lwql_busy", title: "Busy", message: "Try again.", retryable: true };
  const BROKEN = { code: "lwql_unknown_identifier", title: "Unknown", message: "No such column." };
  const failTimes = ({ times, error }: { times: number; error: typeof BUSY | typeof BROKEN }) =>
    Array.from({ length: times }).reduce<WidgetQueryRecords>(
      (records) => recordQueryFailure({ records, queryName: "main", error }),
      {},
    );

  it("fails the widget on a query that fails for good before it ever answered", () => {
    expect(widgetFace(failTimes({ times: 1, error: BROKEN }))).toEqual({
      kind: "failed",
      error: BROKEN,
    });
  });

  it("waits out the frame's retries of a retryable failure", () => {
    expect(widgetFace(failTimes({ times: 3, error: BUSY })).kind).toBe("chart");
    expect(widgetFace(failTimes({ times: 4, error: BUSY })).kind).toBe("failed");
  });

  it("keeps a query that answered once, whatever its refresh does", () => {
    const answered = recordQueryResult({ records: {}, queryName: "main", completeness: PARTIAL });
    const refreshFailed = recordQueryFailure({
      records: answered,
      queryName: "main",
      error: BROKEN,
    });

    expect(widgetFace(refreshFailed)).toEqual({
      kind: "chart",
      completeness: { state: "partial", reports: [PARTIAL] },
    });
  });

  it("names the first field no row carries, with what the query counts", () => {
    const records = recordQueryResult({ records: {}, queryName: "main", completeness: MISSING });

    expect(widgetFace(records)).toEqual({
      kind: "missing",
      missing: { field: "TopicId", label: "topic" },
      unit: "traces",
    });
  });

  it("is no traffic when the query found none", () => {
    const records = recordQueryResult({ records: {}, queryName: "main", completeness: NO_TRAFFIC });

    expect(widgetFace(records)).toEqual({ kind: "no_traffic", unit: "traces" });
  });

  /** @scenario "A widget that also reads outside the period draws its own empty face" */
  it("leaves an empty period to the widget when a query reads outside it", () => {
    const empty = recordQueryResult({ records: {}, queryName: "main", completeness: NO_TRAFFIC });
    const records = recordQueryResult({
      records: empty,
      queryName: "present",
      completeness: undefined,
    });

    expect(widgetFace(records).kind).toBe("chart");
  });
});

describe("sampleNote", () => {
  /** @scenario "The info tip says how much a widget with whole data checked" */
  it("names the rows a complete widget checked, and nothing for partial or empty data", () => {
    expect(sampleNote(combineCompleteness([report({ total: 1234 })]))).toBe(
      "Checked 1,234 traces in this period.",
    );
    expect(sampleNote(combineCompleteness([PARTIAL]))).toBeUndefined();
    expect(sampleNote(combineCompleteness([NO_TRAFFIC]))).toBeUndefined();
    expect(sampleNote(null)).toBeUndefined();
  });
});
