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
      "(spans.TenantId, spans.TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics",
    );
    expect(sql).not.toMatch(/[^,] TraceId IN \(SELECT TraceId/);
    expect(sql).not.toContain("SELECT *");
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
