/**
 * ADR-202, "The typed builder": the shapes analytics' reads and trace's filter compiler need: a
 * set subquery, FULL OUTER JOIN, zoned interval buckets, quantile variants, addDays, Array(JSON)
 * paths and a `:` in a log comment.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { boundRows } from "../bound-rows.ts";
import { column, cond, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    TotalCost: column.float64(),
    Attributes: column.stringMap(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    DurationMs: column.array(column.float64()),
    SpanAttributes: column.stringMap(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });

/** The refusal a build throws, by code and violation kind, never by message. */
function refusalOf(build: () => unknown): { code: unknown; kind: unknown } {
  try {
    build();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && "violation" in error) {
      const { violation } = error;
      const kind =
        typeof violation === "object" && violation !== null && "kind" in violation
          ? violation.kind
          : undefined;
      return { code: error.code, kind };
    }
    throw error;
  }
  throw new Error("expected a refusal; the build succeeded");
}

describe("given a filter testing membership in another table's keys", () => {
  describe("when the tuple of tenant and trace is looked up within a span read", () => {
    /** @scenario "A set subquery tests membership under the read's own scope" */
    it("renders main's IN (SELECT …), the inner read carrying its own tenant predicate", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .where(({ within, not }) =>
          not(
            within(fn.tuple(summaries.TenantId, summaries.TraceId), (sub) =>
              sub
                .from(spans)
                .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
                .where(({ eq }) => eq(spans.SpanName, "llm")),
            ),
          ),
        )
        .build();

      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND NOT (tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM stored_spans WHERE TenantId = {tenantId:String} AND SpanName = {v0:String}))",
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: "llm" });
      expect(built.tenantColumns).toEqual(["TenantId"]);
    });

    /** @scenario "A set subquery tests membership under the read's own scope" */
    it("refuses an inner read under another scope, of no tenant table, or of the wrong width", () => {
      const other = tenantScope.single({ tenantId: "proj_b" });
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ within }) =>
              within(summaries.TraceId, () =>
                clickhouseRead({ scope: other }).from(spans).select({ TraceId: spans.TraceId }),
              ),
            )
            .build(),
        ).kind,
      ).toBe("foreign-scope");
      expect(
        refusalOf(() => {
          const ids = boundRows({ name: "ids", arrays: { TraceId: param.strings(["t1"]) } });
          return clickhouseRead({ scope: single })
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ within }) =>
              within(summaries.TraceId, (sub) => sub.from(ids).select({ TraceId: ids.TraceId })),
            )
            .build();
        }).kind,
      ).toBe("no-tenant-table");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ within }) =>
              within(fn.tuple(summaries.TenantId, summaries.TraceId), (sub) =>
                sub.from(spans).select({ TraceId: spans.TraceId }),
              ),
            )
            .build(),
        ).kind,
      ).toBe("set-arity");
    });

    /** @scenario "A set subquery tests membership under the read's own scope" */
    it("refuses a scalar subquery started under another scope too", () => {
      const other = tenantScope.single({ tenantId: "proj_b" });
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ eq, scalar }) =>
              eq(
                summaries.UpdatedAt,
                scalar(() =>
                  clickhouseRead({ scope: other })
                    .from(summaries)
                    .select({ v: fn.max(summaries.UpdatedAt) }),
                ),
              ),
            )
            .build(),
        ).kind,
      ).toBe("foreign-scope");
    });
  });

  describe("when a filter is empty", () => {
    /** @scenario "A set subquery tests membership under the read's own scope" */
    it("cond.always renders main's 1 = 1", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .where(() => cond.always())
        .build();
      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND 1 = 1",
      );
    });
  });
});

describe("given two metric reads grouped by the same key", () => {
  const metric = (alias: string) =>
    clickhouseRead({ scope: single })
      .from(summaries)
      .select({ TenantId: summaries.TenantId, group_key: summaries.TraceId, v: fn.count() })
      .groupBy(summaries.TenantId, summaries.TraceId)
      .as(alias);

  describe("when the second is full-joined to the first on the key", () => {
    /** @scenario "A FULL OUTER JOIN matches tenants before the caller's key" */
    it("renders FULL OUTER JOIN, the tenant columns matched before the key", () => {
      const left = metric("sq0");
      const right = metric("sq1");
      const built = clickhouseRead({ scope: single })
        .from(left)
        .fullJoin(right, ({ eq }) => eq(left.group_key, right.group_key))
        .select({ a: left.v, b: right.v })
        .build();
      expect(built.sql).toBe(
        "SELECT sq0.v AS a, sq1.v AS b FROM (SELECT TenantId, TraceId AS group_key, count() AS v FROM trace_summaries WHERE TenantId = {tenantId:String} GROUP BY TenantId, TraceId) AS sq0 FULL OUTER JOIN (SELECT TenantId, TraceId AS group_key, count() AS v FROM trace_summaries WHERE TenantId = {tenantId:String} GROUP BY TenantId, TraceId) AS sq1 ON sq0.TenantId = sq1.TenantId AND sq0.group_key = sq1.group_key",
      );
    });

    /** @scenario "A FULL OUTER JOIN matches tenants before the caller's key" */
    it("refuses a side dropping its tenant, a side of bound rows, and a side of another scope", () => {
      const left = metric("sq0");
      const untenanted = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ group_key: summaries.TraceId })
        .as("sq1");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(left)
            .fullJoin(untenanted, ({ eq }) => eq(left.group_key, untenanted.group_key))
            .select({ a: left.v }),
        ).kind,
      ).toBe("unjoinable");
      const rows = boundRows({ name: "keys", arrays: { group_key: param.strings(["t1"]) } });
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(left)
            .fullJoin(rows, ({ eq }) => eq(left.group_key, rows.group_key))
            .select({ a: left.v }),
        ).kind,
      ).toBe("unjoinable");
      const foreign = clickhouseRead({ scope: tenantScope.single({ tenantId: "proj_b" }) })
        .from(summaries)
        .select({ TenantId: summaries.TenantId, group_key: summaries.TraceId })
        .as("sq2");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(left)
            .fullJoin(foreign, ({ eq }) => eq(left.group_key, foreign.group_key))
            .select({ a: left.v }),
        ).kind,
      ).toBe("foreign-scope");
    });
  });
});

describe("given analytics' timeseries functions", () => {
  describe("when buckets, percentiles, day offsets and a log comment are built", () => {
    /** @scenario "Zoned interval buckets, percentile variants and addDays render as main writes them" */
    it("binds each width, zone and day count, the quantile level a checked constant", () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          hours: fn.toStartOfInterval(
            spans.StartTime,
            { hours: 3 },
            { timeZone: "Europe/Amsterdam" },
          ),
          minutes: fn.toStartOfInterval(spans.StartTime, { minutes: 15 }, { timeZone: "UTC" }),
          days: fn.toStartOfInterval(spans.StartTime, { days: 2 }),
          minute: fn.toStartOfMinute(spans.StartTime, { timeZone: "UTC" }),
          p50: fn.quantileExact(0.5, fn.toFloat64(spans.StartTime)),
          p90: fn.quantileExactArray(0.9, spans.DurationMs),
          p99: fn.quantileTDigestArray(0.99, spans.DurationMs),
          tokens: fn.sum(fn.toUInt64OrZero(fn.mapGet(spans.SpanAttributes, "tokens"))),
        })
        .where(({ lt }) => lt(spans.StartTime, fn.addDays(param.epochMs(1_000), 2)))
        .settings({ log_comment: "analytics:timeseries:stored_spans" })
        .build();
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT toStartOfInterval(StartTime, toIntervalHour({v0:UInt32}), {v1:String}) AS hours, toStartOfInterval(StartTime, toIntervalMinute({v2:UInt32}), {v3:String}) AS minutes, toStartOfInterval(StartTime, toIntervalDay({v4:UInt32})) AS days, toStartOfMinute(StartTime, {v5:String}) AS minute, quantileExact(0.5)(toFloat64(StartTime)) AS p50, quantileExactArray(0.9)(DurationMs) AS p90, quantileTDigestArray(0.99)(DurationMs) AS p99, sum(toUInt64OrZero(SpanAttributes[{v6:String}])) AS tokens FROM stored_spans WHERE TenantId = {tenantId:String} AND StartTime < addDays(fromUnixTimestamp64Milli({v7:Int64}), {v8:UInt32}) SETTINGS log_comment = 'analytics:timeseries:stored_spans'"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": 3,
          "v1": "Europe/Amsterdam",
          "v2": 15,
          "v3": "UTC",
          "v4": 2,
          "v5": "UTC",
          "v6": "tokens",
          "v7": 1000,
          "v8": 2,
        }
      `);
    });

    /** @scenario "Zoned interval buckets, percentile variants and addDays render as main writes them" */
    it("refuses a width of two units, a fractional width, and a quote in a setting", () => {
      const twoUnits: { hours: number } = Object.assign({ hours: 1 }, { minutes: 1 });
      expect(refusalOf(() => fn.toStartOfInterval(spans.StartTime, twoUnits)).kind).toBe(
        "bad-constant",
      );
      expect(refusalOf(() => fn.toStartOfInterval(spans.StartTime, { hours: 1.5 })).kind).toBe(
        "bad-constant",
      );
      expect(refusalOf(() => fn.addDays(spans.StartTime, -1)).kind).toBe("bad-constant");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(spans)
            .select({ SpanId: spans.SpanId })
            .settings({ log_comment: "a:b'" }),
        ).kind,
      ).toBe("refused-setting");
    });
  });

  describe("when a JSON array attribute is joined to its elements and a path read", () => {
    /** @scenario "Zoned interval buckets, percentile variants and addDays render as main writes them" */
    it("extracts Array(JSON) and reads the path with getSubcolumn, one arrayJoin reused", () => {
      const context = fn.arrayJoin(
        fn.JSONExtract(
          fn.mapGet(spans.SpanAttributes, "langwatch.rag.contexts"),
          column.array(column.json()),
        ),
      );
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          document_id: fn.toString(fn.getSubcolumn(context, "document_id")),
          content: fn.toString(fn.getSubcolumn(context, "content")),
        })
        .build();
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT toString(getSubcolumn(arrayJoin(JSONExtract(SpanAttributes[{v0:String}], {v1:String})), {v2:String})) AS document_id, toString(getSubcolumn(arrayJoin(JSONExtract(SpanAttributes[{v0:String}], {v1:String})), {v3:String})) AS content FROM stored_spans WHERE TenantId = {tenantId:String}"`,
      );
    });
  });
});
