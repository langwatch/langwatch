/**
 * Compiler tests, organised around the acceptance criteria in issue #6346.
 *
 * The security-relevant cases assert on the *generated SQL and params*, not on
 * a boolean the compiler reports about itself — a compiler that claims it
 * scoped a query is not evidence that the emitted SQL is scoped.
 */

import { describe, expect, it } from "vitest";

import { compile } from "../compiler";
import { LwqlError } from "../errors";
import type { GatingContext } from "../gating";
import type { LwqlQuery } from "../ir";
import { parseLwql } from "../parser";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const UNGATED: GatingContext = { cutoffMs: null };
const GATED: GatingContext = { cutoffMs: NOW - 14 * 86_400_000 };

const compileQuery = (
  query: LwqlQuery,
  { projectId = "project-alpha", gating = UNGATED } = {},
) => compile(query, { projectId, gating, now: NOW });

const compileText = (
  text: string,
  { projectId = "project-alpha", gating = UNGATED } = {},
) => compileQuery(parseLwql(text, { now: NOW }), { projectId, gating });

/** Values bound as params, for asserting nothing user-supplied reached the SQL. */
const paramValues = (params: Record<string, unknown>) => Object.values(params);

describe("tenant isolation", () => {
  it("constrains TenantId to the supplied projectId on every query", () => {
    const { sql, params } = compileText("SELECT trace_id FROM traces");

    expect(sql).toContain("TenantId = {");
    expect(paramValues(params)).toContain("project-alpha");
  });

  it("keeps the tenant predicate outside the caller's OR group", () => {
    // The classic escape: `WHERE tenant = me OR 1=1`. Because the caller's
    // predicate is parenthesised and ANDed, no OR inside it can widen scope.
    const { sql } = compileText(
      "SELECT trace_id FROM traces WHERE has_error = true OR span_count > 0",
    );

    const tenantIndex = sql.indexOf("TenantId = {");
    const orIndex = sql.indexOf(" OR ");
    expect(tenantIndex).toBeGreaterThanOrEqual(0);
    expect(orIndex).toBeGreaterThan(tenantIndex);
    // The OR is inside a parenthesised group, so it cannot reach the top level.
    expect(sql).toMatch(/WHERE TenantId = \{[^}]+\} AND .* AND \(.* OR .*\)/s);
  });

  it("does not let a caller widen scope by filtering project_id", () => {
    // `project_id` is queryable, but filtering it can only ever narrow: the
    // injected predicate is ANDed, so naming another tenant yields no rows
    // rather than that tenant's rows.
    const { sql, params } = compileText(
      "SELECT trace_id FROM traces WHERE project_id = 'project-victim'",
    );

    expect(paramValues(params)).toContain("project-alpha");
    expect(paramValues(params)).toContain("project-victim");
    expect(sql).toMatch(/TenantId = \{p\d+:String\} AND/);
  });

  it("ignores any tenant key smuggled into the IR", () => {
    // `.strict()` on the schema is what makes this a validation error rather
    // than a silently ignored field — but the compiler is also structurally
    // incapable of reading tenant identity from the query.
    const { params } = compileQuery({
      from: "traces",
      select: [{ field: "trace_id" }],
    } as LwqlQuery);

    expect(paramValues(params)).toContain("project-alpha");
  });
});

describe("allowlist totality", () => {
  it("rejects an unknown field rather than passing it through", () => {
    expect(() => compileText("SELECT nonexistent FROM traces")).toThrow(
      LwqlError,
    );
    expect(() => compileText("SELECT nonexistent FROM traces")).toThrow(
      /Unknown field 'nonexistent'/,
    );
  });

  it("rejects an unknown entity", () => {
    expect(() => compileText("SELECT trace_id FROM secrets")).toThrow(
      /Unknown entity 'secrets'/,
    );
  });

  it("rejects an unknown aggregate function", () => {
    expect(() =>
      compileText("SELECT groupArray(trace_id) FROM traces"),
    ).toThrow(/Unknown function 'groupArray'/);
  });

  it("suggests the closest field on a typo", () => {
    try {
      compileText("SELECT duration_m FROM traces");
      throw new Error("expected a compile error");
    } catch (error) {
      expect((error as LwqlError).hint).toBe("Did you mean 'duration_ms'?");
    }
  });

  it("never emits a caller-supplied string in identifier position", () => {
    const { sql, params } = compileText(
      "SELECT trace_id FROM traces WHERE topic_id = 'DROP TABLE traces'",
    );

    expect(sql).not.toContain("DROP TABLE");
    expect(paramValues(params)).toContain("DROP TABLE traces");
  });

  it("binds values as parameters rather than interpolating them", () => {
    const { sql, params } = compileText(
      "SELECT trace_id FROM traces WHERE topic_id = 'o''brien'",
    );

    expect(sql).toMatch(/topic_id|TopicId/);
    expect(sql).not.toContain("brien");
    expect(Object.keys(params).length).toBeGreaterThan(0);
  });
});

describe("content gating (issue #6346 decision 7)", () => {
  it("allows gated fields when the plan has no visibility window", () => {
    expect(() =>
      compileText("SELECT input FROM traces", { gating: UNGATED }),
    ).not.toThrow();
  });

  it("refuses a gated field as an output column when gating is active", () => {
    expect(() =>
      compileText("SELECT input FROM traces", { gating: GATED }),
    ).toThrow(/not available on your current plan/);
  });

  it("refuses a gated field as a FILTER target — the content oracle", () => {
    // This is the case a projection-only rule misses: no content is returned,
    // yet the predicate reveals it one bit at a time.
    let thrown: LwqlError | undefined;
    try {
      compileText("SELECT count(*) FROM traces WHERE input LIKE '%acme%'", {
        gating: GATED,
      });
    } catch (error) {
      thrown = error as LwqlError;
    }

    expect(thrown).toBeInstanceOf(LwqlError);
    expect(thrown!.code).toBe("content_gated");
    // The hint must explain *why* filtering is refused, or the restriction
    // reads as arbitrary and users work around it instead of upgrading.
    expect(thrown!.hint).toMatch(/FILTER/);
    expect(thrown!.hint).toMatch(/filtering on a value reveals it/i);
  });

  it("refuses a gated field as a GROUP BY target", () => {
    expect(() =>
      compileText("SELECT count(*), error FROM traces GROUP BY error", {
        gating: GATED,
      }),
    ).toThrow(/not available on your current plan|cannot be used in GROUP BY/);
  });

  it("refuses a gated field as an aggregation target", () => {
    expect(() =>
      compileText("SELECT count(input) FROM traces", { gating: GATED }),
    ).toThrow(/not available on your current plan/);
  });

  it("leaves metadata and metrics queryable while gating is active", () => {
    // ADR-028's principle survives: existence and signal are never gated.
    expect(() =>
      compileText(
        "SELECT model, avg(cost_usd) FROM traces WHERE has_error = true GROUP BY model",
        { gating: GATED },
      ),
    ).not.toThrow();
  });
});

describe("safety limits", () => {
  it("applies a default time bound when the caller supplies none", () => {
    const { sql } = compileText("SELECT trace_id FROM traces");
    expect(sql).toContain("OccurredAt >=");
    expect(sql).toContain("OccurredAt <=");
  });

  it("rejects a time range beyond the maximum", () => {
    expect(() =>
      compileQuery({
        from: "traces",
        select: [{ field: "trace_id" }],
        time_range: { from: NOW - 400 * 86_400_000, to: NOW },
      }),
    ).toThrow(/exceeds the 90-day maximum/);
  });

  it("clamps the row limit and fetches one extra row to detect truncation", () => {
    const { sql, limit } = compileQuery({
      from: "traces",
      select: [{ field: "trace_id" }],
      limit: 999_999,
    });

    expect(limit).toBe(10_000);
    expect(sql).toContain("LIMIT 10001");
  });

  it("defaults the limit when none is given", () => {
    const { limit, sql } = compileText("SELECT trace_id FROM traces");
    expect(limit).toBe(100);
    expect(sql).toContain("LIMIT 101");
  });
});

describe("timestamp binding", () => {
  // Regression guard. ISO-8601 compiles fine and reads fine; ClickHouse then
  // rejects it at runtime ("only 23 of 24 bytes was parsed") because of the
  // trailing Z. Every query carries a time bound, so that broke every query
  // while all 33 unit tests stayed green — the integration suite caught it.
  const timestampParams = (params: Record<string, unknown>) =>
    Object.values(params).filter(
      (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v),
    ) as string[];

  it("binds the default time window in ClickHouse's DateTime64 format", () => {
    const { params } = compileText("SELECT trace_id FROM traces");
    const stamps = timestampParams(params);

    expect(stamps).toHaveLength(2);
    for (const stamp of stamps) {
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(stamp).not.toContain("T");
      expect(stamp).not.toContain("Z");
    }
  });

  it("binds a caller-supplied timestamp comparison in the same format", () => {
    const { params } = compileQuery({
      from: "traces",
      select: [{ field: "trace_id" }],
      where: [{ field: "started_at", op: ">", value: "2026-07-30T12:00:00Z" }],
    });

    for (const stamp of timestampParams(params)) {
      expect(stamp).not.toMatch(/[TZ]/);
    }
  });
});

describe("aggregation correctness", () => {
  it("unnests Models for grouping but uses has() for filtering", () => {
    const { sql } = compileText(
      "SELECT model, count(*) FROM traces WHERE model = 'gpt-4o' GROUP BY model",
    );

    expect(sql).toContain("arrayJoin(if(empty(Models), ['unknown'], Models))");
    expect(sql).toMatch(/has\(Models, \{p\d+:String\}\)/);
  });

  it("rejects a bare field alongside an aggregate unless grouped", () => {
    expect(() => compileText("SELECT trace_id, count(*) FROM traces")).toThrow(
      /must appear in GROUP BY or be aggregated/,
    );
  });

  it("rejects ORDER BY on a field that is neither grouped nor aggregated", () => {
    // Found by probing the real database during self-review: this previously
    // compiled and ClickHouse rejected it with code 215, so the caller got a
    // raw DB error instead of a message naming the fix.
    expect(() =>
      compileText(
        "SELECT model, count(*) AS n FROM traces GROUP BY model ORDER BY duration_ms DESC",
      ),
    ).toThrow(/neither grouped nor aggregated/);
  });

  it("allows ORDER BY a grouping key", () => {
    expect(() =>
      compileText(
        "SELECT model, count(*) AS n FROM traces GROUP BY model ORDER BY model ASC",
      ),
    ).not.toThrow();
  });

  it("allows ORDER BY an aggregate alias", () => {
    expect(() =>
      compileText(
        "SELECT model, count(*) AS n FROM traces GROUP BY model ORDER BY n DESC",
      ),
    ).not.toThrow();
  });

  it("rejects GROUP BY without an aggregate", () => {
    expect(() =>
      compileText("SELECT model FROM traces GROUP BY model"),
    ).toThrow(/requires at least one aggregate/);
  });

  it("rejects a numeric aggregate over a string field", () => {
    expect(() => compileText("SELECT avg(trace_id) FROM traces")).toThrow(
      /needs a numeric field/,
    );
  });

  it("maps p95 to a ClickHouse quantile", () => {
    const { sql } = compileText("SELECT p95(duration_ms) FROM traces");
    expect(sql).toContain("quantile(0.95)(TotalDurationMs)");
  });

  it("rejects SELECT *", () => {
    expect(() => compileText("SELECT * FROM traces")).toThrow(
      /SELECT \* is not supported/,
    );
  });
});

describe("type checking", () => {
  it("rejects a string compared to a numeric field", () => {
    expect(() =>
      compileQuery({
        from: "traces",
        select: [{ field: "trace_id" }],
        where: [{ field: "duration_ms", op: ">", value: "fast" }],
      }),
    ).toThrow(/is numeric but was compared to string/);
  });

  it("rejects LIKE on a numeric field", () => {
    expect(() =>
      compileQuery({
        from: "traces",
        select: [{ field: "trace_id" }],
        where: [{ field: "duration_ms", op: "like", value: "1%" }],
      }),
    ).toThrow(/LIKE is only valid on string fields/);
  });
});

describe("spans entity", () => {
  it("compiles against stored_spans with its own tenant and time columns", () => {
    const { sql } = compileText(
      "SELECT tool_name, count(*) FROM spans GROUP BY tool_name",
    );

    expect(sql).toContain("FROM stored_spans");
    expect(sql).toContain("TenantId = {");
    expect(sql).toContain("StartTime >=");
    expect(sql).toContain("gen_ai.tool.name");
  });
});
