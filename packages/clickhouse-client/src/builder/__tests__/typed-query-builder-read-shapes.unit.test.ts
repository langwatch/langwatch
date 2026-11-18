/**
 * ADR-202, "The typed builder": the shapes the repositories issue and the
 * server-metadata scope, rendered as text and refused by code.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { column, param, sql } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { systemColumns, systemReplicas, systemServerSettings } from "../system-tables.ts";
import { aliasOf, defineClickHouseTable, systemTable } from "../table.ts";

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
    ParentSpanId: column.nullable(column.string()),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
    Tags: column.stringArray(),
  },
});

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    TotalCost: column.float64(),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });
const metadata = tenantScope.serverMetadata({ reason: "schema column list" });

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

describe("the typed read builder, for the shapes the repositories issue", () => {
  describe("when a read calls functions from the catalogue", () => {
    /** @scenario "A read calls only catalogued functions, binding every value" */
    it("renders each call and binds its values by the function's signature", () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select(({ eq }) => ({
          errors: fn.countIf(eq(spans.SpanName, "error")),
          webCost: fn.sumIf(
            fn.toFloat64(fn.mapGet(spans.SpanAttributes, "cost")),
            eq(fn.mapGet(spans.SpanAttributes, "orchestrator"), "web"),
          ),
          bucket: fn.toStartOfInterval(spans.StartTime, { seconds: 60 }),
          p95: fn.quantileTDigest(0.95, fn.toUnixTimestamp64Milli(spans.StartTime)),
          named: fn.if(fn.startsWith(spans.SpanName, "llm."), spans.SpanName, "other"),
          tagged: fn.has(spans.Tags, "beta"),
          parent: fn.ifNull(spans.ParentSpanId, ""),
        }))
        .groupBy(fn.toStartOfInterval(spans.StartTime, { seconds: 60 }))
        .build();

      expectTypeOf(built).toHaveProperty("sql");
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT countIf(SpanName = {v0:String}) AS errors, sumIf(toFloat64(SpanAttributes[{v1:String}]), SpanAttributes[{v2:String}] = {v3:String}) AS webCost, toStartOfInterval(StartTime, toIntervalSecond({v4:UInt32})) AS bucket, quantileTDigest(0.95)(toUnixTimestamp64Milli(StartTime)) AS p95, if(startsWith(SpanName, {v5:String}), SpanName, {v6:String}) AS named, has(Tags, {v7:String}) AS tagged, ifNull(ParentSpanId, {v8:String}) AS parent FROM stored_spans WHERE TenantId = {tenantId:String} GROUP BY toStartOfInterval(StartTime, toIntervalSecond({v9:UInt32}))"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": "error",
          "v1": "cost",
          "v2": "orchestrator",
          "v3": "web",
          "v4": 60,
          "v5": "llm.",
          "v6": "other",
          "v7": "beta",
          "v8": "",
          "v9": 60,
        }
      `);
    });

    /** @scenario "A read calls only catalogued functions, binding every value" */
    it("compares tuples for a keyset cursor and refuses a constant out of bounds", () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({ SpanId: spans.SpanId, at: fn.toUnixTimestamp64Milli(spans.StartTime) })
        .where(({ gt }) =>
          gt(
            fn.tuple(spans.StartTime, spans.SpanId),
            fn.tuple(param.epochMs(1000), param.string("s1")),
          ),
        )
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT SpanId, toUnixTimestamp64Milli(StartTime) AS at FROM stored_spans WHERE TenantId = {tenantId:String} AND tuple(StartTime, SpanId) > tuple(fromUnixTimestamp64Milli({v0:Int64}), {v1:String})"`,
      );
      expect(refusalOf(() => fn.quantile(1.5, spans.StartTime)).kind).toBe("bad-constant");
      // @ts-expect-error a string span name is not a number to sum
      fn.sum(spans.SpanName);
    });
  });

  describe("when a read filters early, after grouping, or per key", () => {
    /** @scenario "PREWHERE, HAVING, DISTINCT and LIMIT BY render in their clauses" */
    it("renders PREWHERE before the scoped WHERE and HAVING after GROUP BY", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId, cost: fn.sum(summaries.TotalCost) })
        .prewhere(({ oneOf }) => oneOf(summaries.TraceId, ["t0", "t1"]))
        .where(({ isNotNull }) => isNotNull(summaries.TotalCost))
        .groupBy(summaries.TraceId)
        .having(({ gt }) => gt(fn.sum(summaries.TotalCost), 2))
        .build();
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT TraceId, sum(TotalCost) AS cost FROM trace_summaries PREWHERE TraceId IN ({v0:Array(String)}) WHERE TenantId = {tenantId:String} AND TotalCost IS NOT NULL GROUP BY TraceId HAVING sum(TotalCost) > {v1:Float64}"`,
      );

      const distinct = clickhouseRead({ scope: single })
        .from(spans)
        .select({ TraceId: spans.TraceId, SpanName: spans.SpanName })
        .distinct()
        .orderBy("TraceId")
        .limitBy(1, spans.TraceId)
        .limit(10)
        .build();
      expect(distinct.sql).toMatchInlineSnapshot(
        `"SELECT DISTINCT TraceId, SpanName FROM stored_spans WHERE TenantId = {tenantId:String} ORDER BY TraceId ASC LIMIT 1 BY TraceId LIMIT 10"`,
      );
    });

    /** @scenario "The IN-tuple election renders in WHERE, in PREWHERE or inside a join side" */
    it("elects the latest version in PREWHERE, and inside the joined side", () => {
      const prewhere = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId, TotalCost: summaries.TotalCost })
        .where(({ eq }) => eq(summaries.TraceId, "t1"))
        .latestVersion({ prewhere: true })
        .build();
      expect(prewhere.sql).toMatchInlineSnapshot(
        `"SELECT TraceId, TotalCost FROM trace_summaries PREWHERE (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE TenantId = {tenantId:String} AND TraceId = {v0:String} GROUP BY TenantId, TraceId) WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}"`,
      );

      const joined = clickhouseRead({ scope: single })
        .from(summaries)
        .innerJoin(spans, ({ eq }) => eq(spans.TraceId, summaries.TraceId), { latestVersion: true })
        .latestVersion()
        .select({ traceId: summaries.TraceId, name: spans.SpanName })
        .build();
      expect(joined.sql).toMatchInlineSnapshot(
        `"SELECT trace_summaries.TraceId AS traceId, stored_spans.SpanName AS name FROM (SELECT TenantId, TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE TenantId = {tenantId:String} GROUP BY TenantId, TraceId)) AS trace_summaries INNER JOIN (SELECT TenantId, TraceId, SpanName FROM stored_spans WHERE TenantId = {tenantId:String} AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE TenantId = {tenantId:String} GROUP BY TenantId, TraceId, SpanId)) AS stored_spans ON trace_summaries.TenantId = stored_spans.TenantId AND stored_spans.TraceId = trace_summaries.TraceId"`,
      );
    });

    /** @scenario "A DateTime64 column is a member of bound epoch milliseconds" */
    it("compares a DateTime64 as epoch milliseconds against an array of them", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .where(({ oneOf }) => oneOf(summaries.OccurredAt, [1000, 2000]))
        .build();
      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}" +
          " AND toUnixTimestamp64Milli(OccurredAt) IN ({v0:Array(Int64)})",
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: [1000, 2000] });
    });
  });

  describe("when a read selects from a read", () => {
    /** @scenario "A derived table is read under its own scope and carries the predicate inside" */
    it("renders the inner read in FROM with the predicate inside, and types its keys", () => {
      const latest = clickhouseRead({ scope: single })
        .from(summaries)
        .select({
          TraceId: summaries.TraceId,
          __latest: fn.argMax(
            fn.tuple(summaries.OccurredAt, summaries.TotalCost),
            summaries.UpdatedAt,
          ),
        })
        .groupBy(summaries.TenantId, summaries.TraceId)
        .as("latest");
      const built = clickhouseRead({ scope: single })
        .from(latest)
        .select({ TraceId: latest.TraceId, TotalCost: fn.tupleElement(latest.__latest, "1") })
        .where(({ gt }) => gt(fn.tupleElement(latest.__latest, "1"), param.float64(2)))
        .build();

      expectTypeOf(built).toHaveProperty("tenantIds");
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT TraceId, tupleElement(__latest, 2) AS TotalCost FROM (SELECT TraceId, argMax(tuple(OccurredAt, TotalCost), UpdatedAt) AS __latest FROM trace_summaries WHERE TenantId = {tenantId:String} GROUP BY TenantId, TraceId) AS latest WHERE tupleElement(__latest, 2) > {v0:Float64}"`,
      );
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: tenantScope.single({ tenantId: "proj_b" }) }).from(latest),
        ).kind,
      ).toBe("foreign-scope");
    });
  });

  describe("when a read joins a table to itself or reads a fragment in a join", () => {
    /** @scenario "A self-join aliases one side and qualifies fragments by their side" */
    it("aliases the second side and qualifies the fragment's columns", () => {
      const parents = aliasOf({ table: spans, alias: "parents" });
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .leftJoin(parents, ({ eq }) => eq(parents.SpanId, fn.assumeNotNull(spans.ParentSpanId)))
        .select({
          SpanId: spans.SpanId,
          parentName: parents.SpanName,
          model: sql.fragment("spans.responseModel"),
          parentModel: sql.fragment("spans.responseModel", parents),
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT stored_spans.SpanId AS SpanId, parents.SpanName AS parentName, coalesce(nullIf(stored_spans.SpanAttributes['gen_ai.response.model'], ''), stored_spans.SpanAttributes['gen_ai.request.model']) AS model, coalesce(nullIf(parents.SpanAttributes['gen_ai.response.model'], ''), parents.SpanAttributes['gen_ai.request.model']) AS parentModel FROM (SELECT TenantId, SpanId, ParentSpanId, SpanAttributes FROM stored_spans WHERE TenantId = {tenantId:String}) AS stored_spans LEFT JOIN (SELECT TenantId, SpanId, SpanName, SpanAttributes FROM stored_spans WHERE TenantId = {tenantId:String}) AS parents ON stored_spans.TenantId = parents.TenantId AND parents.SpanId = assumeNotNull(stored_spans.ParentSpanId)"`,
      );
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(spans)
            .innerJoin(spans, ({ eq }) => eq(spans.SpanId, spans.SpanId)),
        ).kind,
      ).toBe("self-join");
    });
  });

  describe("when a union is ordered, limited or carries WITH in an arm", () => {
    /** @scenario "An ordered or limited UNION ALL orders the whole union" */
    it("wraps the union for its order and parenthesises an arm with its own clauses", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ traceId: summaries.TraceId, cost: summaries.TotalCost })
        .unionAll((arm) =>
          arm
            .from(spans)
            .with("named", (sub) =>
              sub
                .from(spans)
                .select({ TraceId: spans.TraceId })
                .where(({ eq }) => eq(spans.SpanName, "llm")),
            )
            .select({ cost: fn.toFloat64(fn.count()), traceId: spans.TraceId })
            .where(({ oneOf }) => oneOf(spans.TraceId, { cte: "named" }))
            .groupBy(spans.TraceId)
            .orderBy("cost", "DESC")
            .limit(5),
        )
        .orderBy("cost", "DESC")
        .limit(10)
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT traceId, cost FROM (SELECT TraceId AS traceId, TotalCost AS cost FROM trace_summaries WHERE TenantId = {tenantId:String} UNION ALL (WITH named AS (SELECT TraceId FROM stored_spans WHERE TenantId = {tenantId:String} AND SpanName = {v0:String}) SELECT TraceId AS traceId, toFloat64(count()) AS cost FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId IN named GROUP BY TraceId ORDER BY cost DESC LIMIT 5)) ORDER BY cost DESC LIMIT 10"`,
      );
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(summaries)
            .select({ traceId: summaries.TraceId })
            .unionAll((arm) => arm.from(spans).select({ traceId: spans.TraceId }))
            .orderBy(summaries.TotalCost)
            .build(),
        ).kind,
      ).toBe("bad-union-order");
    });
  });

  describe("when a read names an id the id index bounds", () => {
    /** @scenario "A read by id carries the id index marker the client expands" */
    it("renders the equality with its marker, single and composite, and refuses it in a join", () => {
      const one = clickhouseRead({ scope: single })
        .from(spans)
        .select({ SpanId: spans.SpanId })
        .where(({ idBound }) => idBound(spans.TraceId, "trace_1"))
        .latestVersion()
        .build();
      expect(one.sql).toMatchInlineSnapshot(
        `"SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND (TraceId = {v0:String} {{idBound:stored_spans.TraceId:v0}}) AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE TenantId = {tenantId:String} AND (TraceId = {v0:String} {{idBound:stored_spans.TraceId:v0}}) GROUP BY TenantId, TraceId, SpanId)"`,
      );

      const both = clickhouseRead({ scope: single })
        .from(spans)
        .select({ SpanId: spans.SpanId })
        .where(({ idBoundKeys }) =>
          idBoundKeys([spans.TraceId, "trace_1"], [spans.SpanId, "span_1"]),
        )
        .build();
      expect(both.sql).toMatchInlineSnapshot(
        `"SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND (TraceId = {v0:String} AND SpanId = {v1:String} {{idBound:stored_spans.TraceId,SpanId:v0,v1}})"`,
      );

      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(summaries)
            .innerJoin(spans, ({ eq }) => eq(spans.TraceId, summaries.TraceId))
            .select({ traceId: summaries.TraceId })
            .where(({ idBound }) => idBound(spans.TraceId, "trace_1"))
            .build(),
        ).kind,
      ).toBe("id-bound-in-join");
    });
  });

  describe("when a read uses a window function", () => {
    /** @scenario "A read calls only catalogued functions, binding every value" */
    it("renders the call over its partition and order", () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          SpanId: spans.SpanId,
          rank: fn.over(fn.rowNumber(), {
            partitionBy: [spans.TraceId],
            orderBy: [[spans.StartTime, "DESC"]],
          }),
        })
        .build();
      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT SpanId, row_number() OVER (PARTITION BY TraceId ORDER BY StartTime DESC) AS rank FROM stored_spans WHERE TenantId = {tenantId:String}"`,
      );
    });
  });
});

describe("a server-metadata read", () => {
  /** @scenario "A server-metadata read names only the allow-listed system tables" */
  it("reads an allow-listed system table on the reader identity with no tenant setting", () => {
    const built = clickhouseRead({ scope: metadata })
      .from(systemColumns)
      .select({ table: systemColumns.table, name: systemColumns.name })
      .where(({ eq }) => eq(systemColumns.database, fn.currentDatabase()))
      .build();

    expectTypeOf(built.kind).toEqualTypeOf<"metadata">();
    expect(built.sql).toBe(
      "SELECT table, name FROM system.columns WHERE database = currentDatabase()",
    );
    expect(built.identity).toBe("reader");
    expect(built.kind).toBe("metadata");
    expect(built.reason).toBe("schema column list");
    expect(built.settings).not.toHaveProperty(TENANT_IDS_SETTING);
    expect(built).not.toHaveProperty("tenantIds");

    const one = clickhouseRead({ scope: metadata })
      .withoutTable()
      .select({ one: param.uint32(1) })
      .build();
    expect(one.sql).toBe("SELECT {v0:UInt32} AS one");

    const replicas = clickhouseRead({ scope: metadata })
      .from(systemReplicas)
      .select({ replicas: fn.max(systemReplicas.total_replicas) })
      .build();
    expect(replicas.sql).toBe("SELECT max(total_replicas) AS replicas FROM system.replicas");
    const setting = clickhouseRead({ scope: metadata })
      .from(systemServerSettings)
      .select({ value: systemServerSettings.value })
      .where(({ eq }) => eq(systemServerSettings.name, "user_defined_zookeeper_path"))
      .build();
    expect(setting.sql).toBe("SELECT value FROM system.server_settings WHERE name = {v0:String}");
  });

  /** @scenario "A server-metadata read naming any other table is refused" */
  it("does not type-check and is refused for an app table, another system table, or a tenant scope", () => {
    // @ts-expect-error an app table is not on the server-metadata allow-list
    expect(refusalOf(() => clickhouseRead({ scope: metadata }).from(spans)).kind).toBe(
      "table-outside-scope",
    );
    for (const name of [
      "system.query_log",
      "system.processes",
      "system.mutations",
      "system.query_views_log",
      "system.text_log",
      "system.parts",
      "system.disks",
    ]) {
      // @ts-expect-error only the allow-listed system tables are declarable
      const forged = systemTable({ name, columns: { query: column.string() } });
      expect(refusalOf(() => clickhouseRead({ scope: metadata }).from(forged)).kind).toBe(
        "table-outside-scope",
      );
    }
    // @ts-expect-error a tenant read never names a system table
    expect(refusalOf(() => clickhouseRead({ scope: single }).from(systemColumns)).kind).toBe(
      "table-outside-scope",
    );
    // @ts-expect-error a tenant scope has no table-less read
    expect(refusalOf(() => clickhouseRead({ scope: single }).withoutTable()).kind).toBe(
      "table-outside-scope",
    );
    expect(refusalOf(() => tenantScope.serverMetadata({ reason: " " })).kind).toBe(
      "missing-reason",
    );
  });
});
