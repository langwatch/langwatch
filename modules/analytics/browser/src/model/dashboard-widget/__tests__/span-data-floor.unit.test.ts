/**
 * A span widget says where span history starts when its period begins before the span replay's
 * recorded since; every other widget, and every later period, says nothing.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */

import { describe, expect, it } from "vitest";

import { readsSpanMetrics, spanDataFloorNotice } from "../span-data-floor.ts";

const SPAN_QUERY = { sql: "SELECT count() FROM span_metrics WHERE ErrorType != ''" };
const TRACE_QUERY = { sql: "SELECT count() FROM trace_metrics" };
const SINCE = "2026-10-10T08:30:00Z";
const FLOOR = { from: SINCE, rebuilding: false };

describe("spanDataFloorNotice", () => {
  /** @scenario "A span widget whose period starts before the span data says where it starts" */
  it("names the floor's day when the period starts before it", () => {
    expect(
      spanDataFloorNotice({
        queries: [TRACE_QUERY, SPAN_QUERY],
        periodStart: Date.UTC(2026, 9, 1),
        floor: FLOOR,
      }),
    ).toBe("Span data from 10 Oct 2026");
  });

  /** @scenario "A span widget whose period starts after the floor shows no notice" */
  it("says nothing when the period starts at or after the floor", () => {
    expect(
      spanDataFloorNotice({
        queries: [SPAN_QUERY],
        periodStart: Date.parse(SINCE),
        floor: FLOOR,
      }),
    ).toBeNull();
  });

  it("says nothing for a widget that reads no span_metrics", () => {
    expect(
      spanDataFloorNotice({ queries: [TRACE_QUERY], periodStart: 0, floor: FLOOR }),
    ).toBeNull();
  });

  it("says nothing while the floor loads or failed", () => {
    expect(spanDataFloorNotice({ queries: [SPAN_QUERY], periodStart: 0, floor: null })).toBeNull();
  });

  it("says nothing when span history is whole", () => {
    expect(
      spanDataFloorNotice({
        queries: [SPAN_QUERY],
        periodStart: 0,
        floor: { from: null, rebuilding: false },
      }),
    ).toBeNull();
  });

  /** @scenario "A span widget says its history is still being rebuilt before the replay starts" */
  it("says history is being rebuilt, whatever the period, before the replay starts", () => {
    expect(
      spanDataFloorNotice({
        queries: [SPAN_QUERY],
        periodStart: Date.UTC(2026, 10, 1),
        floor: { from: null, rebuilding: true },
      }),
    ).toBe("Span history is still being rebuilt");
  });

  it("says nothing about rebuilding on a widget that reads no span_metrics", () => {
    expect(
      spanDataFloorNotice({
        queries: [TRACE_QUERY],
        periodStart: 0,
        floor: { from: null, rebuilding: true },
      }),
    ).toBeNull();
  });
});

describe("readsSpanMetrics", () => {
  it.each([
    ["SELECT 1 FROM span_metrics", true],
    ["SELECT 1 FROM analytics.span_metrics", true],
    ["SELECT 1 FROM t JOIN span_metrics AS s ON s.TraceId = t.TraceId", true],
    ["SELECT 1 FROM spans", false],
    ["SELECT 1 FROM span_metrics_v2", false],
  ])("reads %s as %s", (sql, expected) => {
    expect(readsSpanMetrics([{ sql }])).toBe(expected);
  });
});
