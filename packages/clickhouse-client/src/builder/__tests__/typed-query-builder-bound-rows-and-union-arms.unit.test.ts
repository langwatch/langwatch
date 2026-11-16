/**
 * ADR-202, "The typed builder": rows zipped from bound arrays read no table and never stand in
 * for a tenant table; a derived read of them joins a tenant read on its condition alone; a
 * UNION ALL arm keeps its own order and LIMIT BY under its own scope.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { checkTenantScope } from "../../tenantGuard.ts";
import { boundRows } from "../bound-rows.ts";
import { column, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError, type QueryBuilderViolation } from "../query-builder-error.ts";
import { clickhouseRead, readerStatementOf } from "../read.ts";
import { type ReaderScope, tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const points = defineClickHouseTable({
  name: "metric_data_points",
  tenantColumn: "TenantId",
  versionColumn: "DedupVersion",
  sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
  columns: {
    TenantId: column.string(),
    SeriesId: column.fixedString({ length: 64 }),
    PointId: column.fixedString({ length: 64 }),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    TimeUnixNano: column.uint64(),
    DedupVersion: column.uint64(),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });
const set = tenantScope.set({ tenantIds: ["proj_a", "proj_b"] });

function violationOf(build: () => unknown): QueryBuilderViolation | undefined {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error.violation;
    throw error;
  }
  return undefined;
}

const spanRowsOf = (seriesIds = param.strings(["s1", "s2"])) =>
  boundRows({
    name: "span_rows",
    arrays: {
      SeriesId: seriesIds,
      FromTime: param.int64s([100, 200]),
      FromNano: param.strings(["7", "8"]),
      FromPoint: param.strings(["p1", "p2"]),
    },
  });

/** The metric successor seek's shape: bound spans, a derived points read, an ordered arm. */
function seekOf({ scope }: { scope: ReaderScope }) {
  const seriesIds = param.strings(["s1", "s2"]);
  const rows = spanRowsOf(seriesIds);
  const spans = clickhouseRead({ scope })
    .from(rows)
    .select({
      SpanSeriesId: rows.SeriesId,
      SpanFromTime: fn.fromUnixTimestamp64Milli(rows.FromTime),
      SpanFromNano: fn.cast(rows.FromNano, column.uint64()),
      SpanFromPoint: rows.FromPoint,
    })
    .as("spans");
  const seriesPoints = clickhouseRead({ scope })
    .from(points)
    .select({
      TenantId: points.TenantId,
      SeriesId: points.SeriesId,
      PointId: points.PointId,
      SeekTime: points.TimeUnixMs,
      TimeUnixNano: points.TimeUnixNano,
    })
    .where(({ and, gte, oneOf }) =>
      and(oneOf(points.SeriesId, seriesIds), gte(points.TimeUnixMs, 50)),
    )
    .as("series_points");
  const selection = {
    SeriesId: seriesPoints.SeriesId,
    PointId: seriesPoints.PointId,
    TimeUnixMs: fn.toUnixTimestamp64Milli(seriesPoints.SeekTime),
  };
  return clickhouseRead({ scope })
    .from(seriesPoints)
    .innerJoin(spans, ({ eq }) =>
      eq(fn.cast(seriesPoints.SeriesId, column.string()), spans.SpanSeriesId),
    )
    .select(selection)
    .where(({ gt }) => gt(seriesPoints.PointId, spans.SpanFromPoint))
    .unionAll((arm) =>
      arm
        .from(seriesPoints)
        .innerJoin(spans, ({ eq }) =>
          eq(fn.cast(seriesPoints.SeriesId, column.string()), spans.SpanSeriesId),
        )
        .select(selection)
        .where(({ gt }) => gt(seriesPoints.SeekTime, spans.SpanFromTime))
        .orderBy(seriesPoints.SeriesId)
        .orderBy(seriesPoints.SeekTime)
        .limitBy(1, seriesPoints.SeriesId),
    )
    .build();
}

const ROWS_SOURCE =
  "(SELECT tupleElement(bound_row, 1) AS SeriesId, tupleElement(bound_row, 2) AS FromTime," +
  " tupleElement(bound_row, 3) AS FromNano, tupleElement(bound_row, 4) AS FromPoint" +
  " FROM (SELECT arrayJoin(arrayZip({v0:Array(String)}, {v2:Array(Int64)}, {v3:Array(String)}," +
  " {v4:Array(String)})) AS bound_row)) AS span_rows";

describe("given rows zipped from bound arrays", () => {
  describe("when a read selects from the rows and joins a tenant read", () => {
    const statement = seekOf({ scope: single });

    /** @scenario "Rows zipped from bound arrays are a source that reads no table" */
    it("reads them from arrayJoin of arrayZip of the bound arrays, a shared array bound once", () => {
      expect(statement.sql).toContain(ROWS_SOURCE);
      expect(statement.sql).toContain("SeriesId IN ({v0:Array(String)})");
      expect(statement.params).toEqual({
        tenantId: "proj_a",
        v0: ["s1", "s2"],
        v1: 50,
        v2: [100, 200],
        v3: ["7", "8"],
        v4: ["p1", "p2"],
      });
    });

    /** @scenario "Rows zipped from bound arrays are a source that reads no table" */
    it("types each column by its array, so a comparison binds as the element does", () => {
      const rows = spanRowsOf();
      expect(rows.FromTime.binding).toEqual({ paramType: "Int64" });
      expect(rows.SeriesId.binding).toEqual({ paramType: "String" });
      expect(fn.fromUnixTimestamp64Milli(rows.FromTime).binding).toEqual({
        paramType: "Int64",
        conversion: "fromUnixTimestamp64Milli",
      });
    });
  });

  describe("when a column is not a bound array, the arrays differ in length or none is given", () => {
    /** @scenario "Rows zipped from bound arrays are a source that reads no table" */
    it("refuses each", () => {
      const sorted = fn.arraySort(param.strings(["b", "a"]));
      expect(violationOf(() => boundRows({ name: "r", arrays: { Sorted: sorted } }))).toEqual({
        kind: "bound-rows-not-arrays",
        column: "Sorted",
      });
      expect(
        violationOf(() =>
          boundRows({ name: "r", arrays: { A: param.strings(["a"]), B: param.int64s([1, 2]) } }),
        ),
      ).toEqual({ kind: "bound-rows-uneven", lengths: [1, 2] });
      expect(violationOf(() => boundRows({ name: "r", arrays: {} }))?.kind).toBe(
        "bound-rows-not-arrays",
      );
    });
  });

  describe("when a server-metadata read names the rows", () => {
    /** @scenario "Rows zipped from bound arrays are a source that reads no table" */
    it("refuses it: server metadata reads allow-listed system tables only", () => {
      const metadata = tenantScope.serverMetadata({ reason: "bound rows test" });
      const rows = spanRowsOf();
      expect(
        violationOf(() =>
          // @ts-expect-error a server-metadata read names allow-listed system tables only
          clickhouseRead({ scope: metadata }).from(rows),
        )?.kind,
      ).toBe("table-outside-scope");
    });
  });
});

describe("given a read whose only sources are bound rows", () => {
  const everyTenant = tenantScope.allTenants({ reason: "bound rows test" });

  describe("when it is built under a single, a set or an all-tenants scope", () => {
    /** @scenario "Bound rows never stand in for a tenant table" */
    it("refuses it", () => {
      for (const scope of [single, set, everyTenant]) {
        const rows = spanRowsOf();
        const derived = clickhouseRead({ scope })
          .from(rows)
          .select({ SeriesId: rows.SeriesId })
          .as("rows_only");
        expect(
          violationOf(() =>
            clickhouseRead({ scope }).from(rows).select({ SeriesId: rows.SeriesId }).build(),
          ),
        ).toEqual({ kind: "no-tenant-table" });
        expect(
          violationOf(() =>
            clickhouseRead({ scope }).from(derived).select({ SeriesId: derived.SeriesId }).build(),
          ),
        ).toEqual({ kind: "no-tenant-table" });
      }
    });
  });

  describe("when the rows join a tenant read", () => {
    /** @scenario "Bound rows never stand in for a tenant table" */
    it("carries that read's tenant predicate and the tenant setting", () => {
      const statement = seekOf({ scope: set });
      expect(statement.sql).toContain("TenantId IN ({tenantIds:Array(String)})");
      expect(statement.settings[TENANT_IDS_SETTING]).toBe("proj_a,proj_b");
      expect(statement.tenantColumns).toEqual(["TenantId"]);
    });
  });
});

describe("given a derived read of bound rows and a derived tenant read", () => {
  describe("when the tenant read joins the rows", () => {
    /** @scenario "A derived read of bound rows joins a tenant read without a tenant equality" */
    it("joins on the caller's condition alone; the tenant side keeps its predicate", () => {
      const { sql } = seekOf({ scope: single });
      expect(sql).toContain(
        "AS spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId WHERE",
      );
      expect(sql).not.toContain("spans.TenantId");
      expect(sql.match(/WHERE TenantId = \{tenantId:String\} AND /g)).toHaveLength(2);
    });
  });

  describe("when the rows are the FROM side and a stored tenant table joins them", () => {
    /** @scenario "A derived read of bound rows joins a tenant read without a tenant equality" */
    it("joins the table's scoped subquery on the condition alone", () => {
      const rows = spanRowsOf();
      const spans = clickhouseRead({ scope: single })
        .from(rows)
        .select({ SpanSeriesId: rows.SeriesId })
        .as("spans");
      const { sql } = clickhouseRead({ scope: single })
        .from(spans)
        .innerJoin(points, ({ eq }) =>
          eq(fn.cast(points.SeriesId, column.string()), spans.SpanSeriesId),
        )
        .select({ PointId: points.PointId })
        .build();
      expect(sql).toContain(
        "INNER JOIN (SELECT TenantId, SeriesId, PointId FROM metric_data_points WHERE TenantId = {tenantId:String}) AS metric_data_points ON CAST(",
      );
    });
  });

  describe("when the tenant read drops its tenant column", () => {
    /** @scenario "A derived read of bound rows joins a tenant read without a tenant equality" */
    it("refuses it as a join side", () => {
      const rows = spanRowsOf();
      const spans = clickhouseRead({ scope: single })
        .from(rows)
        .select({ SpanSeriesId: rows.SeriesId })
        .as("spans");
      const bare = clickhouseRead({ scope: single })
        .from(points)
        .select({ SeriesId: points.SeriesId })
        .as("bare_points");
      expect(
        violationOf(() =>
          clickhouseRead({ scope: single })
            .from(bare)
            .innerJoin(spans, ({ eq }) => eq(bare.SeriesId, spans.SpanSeriesId)),
        ),
      ).toEqual({ kind: "unjoinable", table: "bare_points" });
    });
  });
});

describe("given a union whose second arm is ordered and limited per series", () => {
  describe("when it is built", () => {
    /** @scenario "A UNION ALL arm keeps its own order and LIMIT BY under its own scope" */
    it("renders the arm's ORDER BY and LIMIT 1 BY inside its own parentheses", () => {
      const { sql } = seekOf({ scope: single });
      expect(sql).toMatch(
        / UNION ALL \(SELECT .* WHERE series_points\.SeekTime > spans\.SpanFromTime ORDER BY series_points\.SeriesId ASC, series_points\.SeekTime ASC LIMIT 1 BY series_points\.SeriesId\)$/,
      );
      expect(sql.indexOf("UNION ALL")).toBeGreaterThan(sql.indexOf("spans.SpanFromPoint"));
    });

    /** @scenario "A UNION ALL arm keeps its own order and LIMIT BY under its own scope" */
    it("passes the client's tenant guard under a single and a set scope", () => {
      const forOne = readerStatementOf({ statement: seekOf({ scope: single }) });
      const forSet = readerStatementOf({ statement: seekOf({ scope: set }) });
      expect(
        checkTenantScope({
          sql: forOne.sql,
          params: forOne.params,
          tenantId: forOne.tenantId,
          tenantColumns: forOne.tenantColumns,
        }),
      ).toBeNull();
      expect(
        checkTenantScope({
          sql: forSet.sql,
          params: forSet.params,
          tenantId: forSet.tenantId,
          tenantIds: forSet.tenantIds,
          tenantColumns: forSet.tenantColumns,
        }),
      ).toBeNull();
    });
  });
});

describe("given a table whose engine replaces by StartTime, its descriptor's version UpdatedAt", () => {
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
      StartTime: column.dateTime64({ precision: 9 }),
      UpdatedAt: column.dateTime64({ precision: 3 }),
    },
  });
  const read = () =>
    clickhouseRead({ scope: single })
      .from(spans)
      .select({ SpanId: spans.SpanId })
      .where(({ eq }) => eq(spans.TraceId, "t1"));

  describe("when the read elects naming StartTime as the version", () => {
    /** @scenario "A latest-version read elects on the column its engine replaces by" */
    it("takes the max of StartTime over the descriptor's keys, under the tenant predicate", () => {
      expect(read().latestVersion({ version: spans.StartTime }).build().sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}" +
          " AND (TenantId, TraceId, SpanId, StartTime) IN (SELECT TenantId, TraceId, SpanId," +
          " max(StartTime) FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}" +
          " GROUP BY TenantId, TraceId, SpanId)",
      );
    });
  });

  describe("when the read names no version", () => {
    /** @scenario "A latest-version read elects on the column its engine replaces by" */
    it("elects on the descriptor's version as before", () => {
      expect(read().latestVersion().build().sql).toContain(
        "(TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)",
      );
    });
  });

  describe("when the version names the tenant column or another table's column", () => {
    /** @scenario "A latest-version read elects on the column its engine replaces by" */
    it("refuses it", () => {
      expect(violationOf(() => read().latestVersion({ version: spans.TenantId }))).toEqual({
        kind: "version-outside-election",
        table: "stored_spans",
        column: "stored_spans.TenantId",
      });
      expect(
        // @ts-expect-error a version names a column of the elected table
        violationOf(() => read().latestVersion({ version: points.TimeUnixMs })),
      ).toEqual({
        kind: "version-outside-election",
        table: "stored_spans",
        column: "metric_data_points.TimeUnixMs",
      });
    });
  });
});
