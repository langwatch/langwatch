/**
 * Reading a widget's LWQL text for the origins it names: whether it reads Langy's traces, reads
 * only views origin scoping skips, or pins its own origins.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import {
  COST_PER_CALL_SQL,
  SPEND_BY_SOURCE_SQL,
  WASTE_SQL,
} from "../catalogue/widgets/flight-deck-costs-queries.ts";
import { FLAKY_SCENARIOS_SQL } from "../catalogue/widgets/release-queries.ts";
import {
  queriesPinOriginsWithoutLangy,
  queriesReadLangyTraces,
  queriesReadOnlyUnscopedViews,
} from "../model/board-query-origins.ts";

describe("queriesReadLangyTraces", () => {
  const reads = (sql: string) => queriesReadLangyTraces({ sqls: [sql] });

  describe("given a query that filters on Langy's traces", () => {
    /** @scenario "AC200h Langy setting: a widget that reads Langy's traces on a board that leaves them out is flagged" */
    it.each([
      "SELECT count() FROM trace_metrics WHERE Origin = 'langy'",
      "SELECT count() FROM trace_metrics WHERE origin IN ('application', 'langy')",
      "SELECT count() FROM trace_metrics WHERE TraceName = 'langy.turn'",
      "SELECT count() FROM traces WHERE TraceName IN ('langy.turn')",
      "SELECT count() FROM trace_metrics WHERE Origin = 'app' OR Origin = 'langy'",
    ])("finds it in %s", (sql) => {
      expect(reads(sql)).toBe(true);
    });
  });

  describe("given a query that leaves Langy's traces out or never names them", () => {
    /** @scenario "AC200h Langy setting: a widget that reads Langy's traces on a board that leaves them out is flagged" */
    it.each([
      "SELECT count() FROM trace_metrics",
      "SELECT count() FROM trace_metrics WHERE Origin != 'langy'",
      "SELECT count() FROM trace_metrics WHERE Origin NOT IN ('langy')",
      "SELECT count() FROM trace_metrics WHERE TraceName <> 'langy.turn'",
      "SELECT count() FROM trace_metrics WHERE Origin = 'LANGY'",
      "SELECT count() FROM trace_metrics WHERE NOT Origin = 'langy'",
      "SELECT count() FROM trace_metrics WHERE NOT (Origin = 'langy')",
      'SELECT count() FROM trace_metrics WHERE Origin = "langy"',
      "-- Origin = 'langy'\nSELECT count() FROM trace_metrics",
      "/* Origin = 'langy' */ SELECT count() FROM trace_metrics",
    ])("finds nothing in %s", (sql) => {
      expect(reads(sql)).toBe(false);
    });
  });
});

describe("queriesReadOnlyUnscopedViews", () => {
  const only = (...sqls: string[]) => queriesReadOnlyUnscopedViews({ sqls });

  /** @scenario "AC195 Langy: per-minute rollups cannot leave Langy out yet" */
  it.each([
    ["one rollup", ["SELECT sum(TraceCount) FROM trace_metrics_by_minute"]],
    ["a qualified rollup", ["SELECT 1 FROM analytics.model_usage_by_minute"]],
    ["simulations", ["SELECT count() FROM simulations WHERE Verdict IS NOT NULL"]],
    ["the flaky scenarios widget", [FLAKY_SCENARIOS_SQL]],
    ["an evaluation rollup", ["SELECT sum(Count) FROM evaluation_metrics_by_minute"]],
    [
      "two rollups",
      ["SELECT 1 FROM trace_metrics_by_minute", "SELECT 1 FROM model_usage_by_minute"],
    ],
  ])("is true for %s", (_name, sqls) => {
    expect(only(...sqls)).toBe(true);
  });

  /** @scenario "AC195 Langy: per-minute rollups cannot leave Langy out yet" */
  it.each([
    ["a trace view", ["SELECT 1 FROM trace_metrics"]],
    [
      "a rollup joined to a trace view",
      ["SELECT 1 FROM trace_metrics_by_minute JOIN traces USING (TraceId)"],
    ],
    [
      "one rollup query and one trace query",
      ["SELECT 1 FROM model_usage_by_minute", "SELECT 1 FROM traces"],
    ],
    ["simulations joined to traces", ["SELECT 1 FROM simulations JOIN traces ON 1 = 1"]],
    ["no query", []],
    ["a view named only in a comment", ["SELECT 1 FROM traces -- FROM trace_metrics_by_minute"]],
    [
      "a view named only in a block comment",
      ["SELECT 1 FROM traces /* FROM trace_metrics_by_minute */"],
    ],
  ])("is false for %s", (_name, sqls) => {
    expect(only(...sqls)).toBe(false);
  });
});

describe("queriesPinOriginsWithoutLangy", () => {
  const pinned = (...sqls: string[]) => queriesPinOriginsWithoutLangy({ sqls });

  /** @scenario "AC200i Langy setting: an empty widget that pins its own origins does not blame the board" */
  it.each([
    ["an IN list", ["SELECT 1 FROM traces WHERE Origin IN ('', 'application')"]],
    ["an equality", ["SELECT 1 FROM traces WHERE origin = 'evaluation'"]],
    ["the catalogue's cost per call", [COST_PER_CALL_SQL]],
    ["the catalogue's waste, pinned inside its subquery", [WASTE_SQL]],
    ["a pin in a subquery after FROM", ["SELECT 1 FROM (SELECT 1 FROM t WHERE Origin = 'a')"]],
    [
      "a pin in a subquery after JOIN",
      ["SELECT 1 FROM a JOIN (SELECT 1 FROM t WHERE Origin = 'a') b"],
    ],
    [
      "a WHERE pin beside multiIf labels",
      ["SELECT multiIf(Origin = 'a', 'x', 'y') FROM t WHERE (Origin IN ('b') AND x > 1)"],
    ],
    ["a pin after a function in the filter", ["SELECT 1 WHERE toDate(t) > 1 AND Origin = 'a'"]],
    ["a literal that differs in case", ["SELECT 1 WHERE Origin IN ('a', 'Langy')"]],
    ["every query pinning", ["SELECT 1 WHERE Origin = 'a'", "SELECT 2 WHERE Origin IN ('b')"]],
  ])("is true for %s", (_name, sqls) => {
    expect(pinned(...sqls)).toBe(true);
  });

  /** @scenario "AC200i Langy setting: an empty widget that pins its own origins does not blame the board" */
  it.each([
    ["no filter on origin", ["SELECT 1 FROM traces"]],
    ["simulations joined to traces", ["SELECT 1 FROM simulations JOIN traces ON 1 = 1"]],
    ["no query", []],
    ["an IN list holding langy", ["SELECT 1 WHERE Origin IN ('application', 'langy')"]],
    ["an equality on langy", ["SELECT 1 WHERE Origin = 'langy'"]],
    ["a negation", ["SELECT 1 WHERE Origin != 'application'"]],
    ["a NOT IN", ["SELECT 1 WHERE Origin NOT IN ('application')"]],
    ["a query with no pin among pinned ones", ["SELECT 1 WHERE Origin = 'a'", "SELECT 2"]],
    ["a pin named only in a comment", ["SELECT 1 FROM traces -- WHERE Origin = 'a'"]],
    ["a pin named only in a block comment", ["SELECT 1 FROM t /* WHERE Origin = 'a' */"]],
    ["the catalogue's spend by source", [SPEND_BY_SOURCE_SQL]],
    ["labels in multiIf only", ["SELECT multiIf(Origin = 'a', 'x', 'y') FROM t"]],
    ["a pin inside if() in the select list", ["SELECT if(Origin = 'a', 1, 2) FROM t"]],
  ])("is false for %s", (_name, sqls) => {
    expect(pinned(...sqls)).toBe(false);
  });
});
