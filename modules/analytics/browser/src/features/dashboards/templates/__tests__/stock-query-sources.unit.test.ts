/**
 * A stock query reads a span view through the origin of its trace, looked up by tenant and trace
 * together, so a trace id shared with another project never decides. The condition goes into the
 * select's own WHERE, never behind a wildcard, and leaves strings, comments and CTE names alone.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 */
import { describe, expect, it } from "vitest";

import { readSources } from "../model/stock-query-sources";

const SOURCES = "{dashboard_context_sources:Array(String)}";

describe("given a stock query over a view that names only a row's trace", () => {
  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("looks the trace's origin up by (TenantId, TraceId)", () => {
    const sql = readSources("SELECT count() AS n FROM spans WHERE OccurredAt >= now()");

    expect(sql).toContain(
      "(spans.TenantId, spans.TraceId) NOT IN (SELECT TenantId, TraceId FROM trace_metrics",
    );
    expect(sql).not.toMatch(/[^,] TraceId (NOT )?IN \(SELECT TraceId/);
    expect(sql).not.toContain("SELECT *");
  });

  /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as being in the chosen sources" */
  it.each([
    ["traces", "traces"],
    ["spans", "spans"],
    ["traces AS t", "t"],
    ["analytics.spans s", "s"],
  ])("leaves out the traces of other sources from %s", (from, alias) => {
    expect(readSources(`SELECT 1 FROM ${from} GROUP BY x`)).toBe(
      `SELECT 1 FROM ${from} WHERE notEmpty(${SOURCES}) AND ` +
        `(${alias}.TenantId, ${alias}.TraceId) NOT IN ` +
        `(SELECT TenantId, TraceId FROM trace_metrics WHERE Source NOT IN ${SOURCES}) GROUP BY x`,
    );
  });

  /** @scenario "AC202h Stock widgets: evaluation and annotation widgets still read the traces of the chosen sources" */
  it.each([
    ["evaluations", "evaluations"],
    ["annotations", "annotations"],
    ["evaluations AS e", "e"],
    ["analytics.annotations a", "a"],
  ])("looks the chosen sources up from %s", (from, alias) => {
    expect(readSources(`SELECT 1 FROM ${from} GROUP BY x`)).toBe(
      `SELECT 1 FROM ${from} WHERE (${alias}.TenantId, ${alias}.TraceId) IN ` +
        `(SELECT TenantId, TraceId FROM trace_metrics WHERE Source IN ${SOURCES}) GROUP BY x`,
    );
  });

  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it.each([
    ["spans", "NOT IN"],
    ["evaluations", "IN"],
  ])("keeps the lookup from %s bounded by the period, one window back plus a day", (view, form) => {
    const start = "{dashboard_context_period_start:DateTime}";
    const end = "{dashboard_context_period_end:DateTime}";

    expect(
      readSources(`SELECT 1 FROM ${view} WHERE OccurredAt >= ${start} AND OccurredAt < ${end}`),
    ).toContain(
      `WHERE Source ${form} ${SOURCES} AND OccurredAt >= ` +
        `subtractDays(subtractSeconds(${start}, dateDiff('second', ${start}, ${end})), 1))`,
    );
  });
});

describe("given a query over a view that keeps an origin", () => {
  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("adds the condition to an existing WHERE, parenthesising what was there", () => {
    expect(readSources("SELECT 1 FROM trace_metrics AS t WHERE a OR b GROUP BY x")).toBe(
      `SELECT 1 FROM trace_metrics AS t WHERE t.Source IN ${SOURCES} AND ( a OR b) GROUP BY x`,
    );
  });

  it("adds a WHERE when the select has none, before its GROUP BY", () => {
    expect(readSources("SELECT 1 FROM trace_metrics GROUP BY x")).toBe(
      `SELECT 1 FROM trace_metrics WHERE trace_metrics.Source IN ${SOURCES} GROUP BY x`,
    );
  });

  it("keeps each select of a subquery to the sources on its own", () => {
    const sql = readSources(
      "SELECT n FROM (SELECT count() AS n FROM trace_metrics WHERE a) WHERE n > 1",
    );

    expect(sql).toBe(
      `SELECT n FROM (SELECT count() AS n FROM trace_metrics WHERE trace_metrics.Source IN ${SOURCES} AND ( a)) WHERE n > 1`,
    );
  });

  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("keeps the Source column in the list on evaluation_metrics too", () => {
    expect(readSources("SELECT 1 FROM evaluation_metrics GROUP BY x")).toBe(
      `SELECT 1 FROM evaluation_metrics WHERE evaluation_metrics.Source IN ${SOURCES} GROUP BY x`,
    );
  });
});

describe("given text that only looks like a view reference", () => {
  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("leaves a comment, a string and a CTE named like a view as written", () => {
    const untouched = [
      "SELECT 1 -- FROM trace_metrics\nFROM numbers",
      "SELECT 'FROM trace_metrics' AS s FROM numbers",
      "SELECT 1 /* FROM spans */ FROM numbers",
      "WITH trace_metrics AS (SELECT 1 AS x) SELECT x FROM trace_metrics",
    ];

    for (const sql of untouched) expect(readSources(sql), sql).toBe(sql);
  });

  it("refuses a view joined directly, which a WHERE cannot keep to the sources", () => {
    expect(() => readSources("SELECT 1 FROM numbers JOIN trace_metrics ON 1 = 1")).not.toThrow();
    expect(() => readSources("SELECT 1 FROM trace_metrics JOIN spans ON 1 = 1")).toThrow(
      "joins spans directly",
    );
  });
});
