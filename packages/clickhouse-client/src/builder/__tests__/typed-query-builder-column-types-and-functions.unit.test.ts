/**
 * ADR-202, "The typed builder": the column types, nested columns, functions, lambdas, casts and
 * per-target select lists the repositories read, rendered and refused by code.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ColumnType,
  column,
  type Expression,
  param,
  type ValueOfExpression,
} from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const runs = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    TraceId: column.string(),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    Metadata: column.nullable(column.string()),
    "Messages.Id": column.array(column.string()),
    "Messages.Role": column.array(column.string()),
    "Evaluations.Score": column.array(column.nullable(column.float64())),
    "Evaluations.Passed": column.array(column.nullable(column.uint8())),
    "Criteria.Criterion": column.array(column.string()),
    "Criteria.Status": column.array(column.lowCardinality(column.string())),
    RoleCosts: column.map({ key: column.string(), value: column.array(column.float64()) }),
    RoleTotals: column.map({ key: column.string(), value: column.float64() }),
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
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.map({
      key: column.lowCardinality(column.string()),
      value: column.string(),
    }),
    "Events.Timestamp": column.array(column.dateTime64({ precision: 3 })),
    "Events.Name": column.array(column.lowCardinality(column.string())),
    "Events.Attributes": column.array(
      column.map({ key: column.lowCardinality(column.string()), value: column.string() }),
    ),
  },
});

const rollup = defineClickHouseTable({
  name: "metrics_rollup",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    HourBucket: column.dateTime(),
    PointId: column.fixedString({ length: 64 }),
    Amount: column.decimal({ precision: 18, scale: 6 }),
    Sign: column.int8(),
    Role: column.lowCardinality(column.nullable(column.string())),
    Steps: column.array(column.tuple(column.string(), column.uint32(), column.bool())),
    ToolCounts: column.map({ key: column.lowCardinality(column.string()), value: column.uint32() }),
    SpanCount: column.simpleAggregate({ fn: "sum", of: column.uint64() }),
    LastSeen: column.simpleAggregate({ fn: "max", of: column.dateTime64({ precision: 3 }) }),
    TotalCost: column.aggregateFunction({
      fn: "argMax",
      args: [column.float64(), column.dateTime64({ precision: 3 })],
    }),
    RoleCosts: column.aggregateFunction({
      fn: "argMax",
      args: [
        column.map({ key: column.string(), value: column.float64() }),
        column.dateTime64({ precision: 3 }),
      ],
    }),
    SpendNano: column.aggregateFunction({ fn: "sum", args: [column.int64()] }),
    Requests: column.aggregateFunction({ fn: "count", args: [column.uint64()] }),
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

describe("the typed read builder, for column types, aggregate states, lambdas and casts", () => {
  describe("when a descriptor declares the column types the migrations declare", () => {
    /** @scenario "A descriptor declares nested columns and every column type the migrations declare" */
    it("writes each type's ClickHouse text as the migration does", () => {
      const declared: readonly (readonly [ColumnType<unknown>, string])[] = [
        [
          column.simpleAggregate({ fn: "sum", of: column.uint64() }),
          "SimpleAggregateFunction(sum, UInt64)",
        ],
        [
          column.simpleAggregate({ fn: "max", of: column.uint16() }),
          "SimpleAggregateFunction(max, UInt16)",
        ],
        [column.array(column.lowCardinality(column.string())), "Array(LowCardinality(String))"],
        [column.fixedString({ length: 64 }), "FixedString(64)"],
        [column.array(column.uint64()), "Array(UInt64)"],
        [
          column.map({ key: column.lowCardinality(column.string()), value: column.string() }),
          "Map(LowCardinality(String), String)",
        ],
        [
          column.lowCardinality(column.nullable(column.string())),
          "LowCardinality(Nullable(String))",
        ],
        [
          column.aggregateFunction({
            fn: "sum",
            args: [column.decimal({ precision: 18, scale: 6 })],
          }),
          "AggregateFunction(sum, Decimal(18, 6))",
        ],
        [column.dateTime(), "DateTime"],
        [column.nullable(column.dateTime()), "Nullable(DateTime)"],
        [
          column.map({ key: column.string(), value: column.array(column.float64()) }),
          "Map(String, Array(Float64))",
        ],
        [column.array(column.nullable(column.float64())), "Array(Nullable(Float64))"],
        [column.array(column.uint8()), "Array(UInt8)"],
        [column.array(column.nullable(column.uint8())), "Array(Nullable(UInt8))"],
        [column.array(column.dateTime64({ precision: 3 })), "Array(DateTime64(3))"],
        [
          column.array(
            column.map({ key: column.lowCardinality(column.string()), value: column.string() }),
          ),
          "Array(Map(LowCardinality(String), String))",
        ],
        [
          column.aggregateFunction({
            fn: "argMax",
            args: [
              column.map({ key: column.string(), value: column.float64() }),
              column.dateTime64({ precision: 3 }),
            ],
          }),
          "AggregateFunction(argMax, Map(String, Float64), DateTime64(3))",
        ],
        [
          column.aggregateFunction({ fn: "count", args: [column.uint64()] }),
          "AggregateFunction(count, UInt64)",
        ],
        [
          column.array(column.tuple(column.string(), column.uint32(), column.bool())),
          "Array(Tuple(String, UInt32, Bool))",
        ],
        [column.int8(), "Int8"],
        [column.stringMap(), "Map(String, String)"],
      ];

      expect(declared.map(([type]) => type.clickhouse)).toEqual(declared.map(([, text]) => text));
      expect(refusalOf(() => column.fixedString({ length: 0 })).kind).toBe("bad-constant");
      expect(refusalOf(() => column.decimal({ precision: 18, scale: 19 })).kind).toBe(
        "bad-constant",
      );
      expect(() =>
        defineClickHouseTable({
          name: "t",
          tenantColumn: "TenantId",
          sortKey: ["TenantId"],
          columns: { TenantId: column.string(), "A.b.c": column.string() },
        }),
      ).toThrow('"A.b.c" is not a plain or nested column name');
    });

    /** @scenario "A descriptor declares nested columns and every column type the migrations declare" */
    it("backquotes a nested column, qualified in a join, and binds members as the array holds them", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .innerJoin(spans, ({ eq }) => eq(spans.TraceId, runs.TraceId))
        .select(({ eq }) => ({
          ids: fn.arraySlice(runs["Messages.Id"], 1, 6),
          firstScore: fn.arrayElement(runs["Evaluations.Score"], 1),
          agentCosts: fn.mapGet(runs.RoleCosts, "agent"),
          named: fn.has(spans["Events.Name"], "exception"),
          early: fn.has(spans["Events.Timestamp"], 1_000),
          passed: fn.countIf(eq(fn.arrayElement(runs["Evaluations.Passed"], 1), 1)),
        }))
        .where(({ eq }) => eq(fn.mapGet(spans.SpanAttributes, "kind"), "llm"))
        .groupBy(
          runs["Messages.Id"],
          runs["Evaluations.Score"],
          runs.RoleCosts,
          spans["Events.Name"],
          spans["Events.Timestamp"],
        )
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT arraySlice(simulation_runs.\`Messages.Id\`, {v0:Int64}, {v1:Int64}) AS ids, arrayElement(simulation_runs.\`Evaluations.Score\`, {v2:Int64}) AS firstScore, simulation_runs.RoleCosts[{v3:String}] AS agentCosts, has(stored_spans.\`Events.Name\`, {v4:String}) AS named, has(stored_spans.\`Events.Timestamp\`, fromUnixTimestamp64Milli({v5:Int64})) AS early, countIf(arrayElement(simulation_runs.\`Evaluations.Passed\`, {v6:Int64}) = {v7:UInt8}) AS passed FROM (SELECT TenantId, TraceId, Messages.Id, Evaluations.Score, Evaluations.Passed, RoleCosts FROM simulation_runs WHERE TenantId = {tenantId:String}) AS simulation_runs INNER JOIN (SELECT TenantId, TraceId, SpanAttributes, Events.Timestamp, Events.Name FROM stored_spans WHERE TenantId = {tenantId:String}) AS stored_spans ON simulation_runs.TenantId = stored_spans.TenantId AND stored_spans.TraceId = simulation_runs.TraceId WHERE stored_spans.SpanAttributes[{v8:String}] = {v9:String} GROUP BY simulation_runs.\`Messages.Id\`, simulation_runs.\`Evaluations.Score\`, simulation_runs.RoleCosts, stored_spans.\`Events.Name\`, stored_spans.\`Events.Timestamp\`"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": 1,
          "v1": 6,
          "v2": 1,
          "v3": "agent",
          "v4": "exception",
          "v5": 1000,
          "v6": 1,
          "v7": 1,
          "v8": "kind",
          "v9": "llm",
        }
      `);
      expectTypeOf<ValueOfExpression<(typeof runs)["Evaluations.Score"]>>().toEqualTypeOf<
        readonly (number | null)[]
      >();
    });

    /** @scenario "A descriptor declares nested columns and every column type the migrations declare" */
    it("binds a compared value as the inner type of each wrapper", () => {
      const built = clickhouseRead({ scope: single })
        .from(rollup)
        .select({
          trace: rollup.TraceId,
          steps: fn.tupleElement(fn.arrayElement(rollup.Steps, 1), "1"),
        })
        .where(({ and, eq, gt, range }) =>
          and(
            eq(rollup.SpanCount, 3),
            range(rollup.HourBucket, { from: 1_000, until: 2_000 }),
            gt(rollup.LastSeen, 500),
            eq(rollup.Sign, -1),
            eq(rollup.PointId, "p".repeat(64)),
            eq(rollup.Role, "agent"),
            gt(rollup.Amount, 1.5),
            gt(fn.mapGet(rollup.ToolCounts, "bash"), 2),
          ),
        )
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT TraceId AS trace, tupleElement(arrayElement(Steps, {v0:Int64}), 2) AS steps FROM metrics_rollup WHERE TenantId = {tenantId:String} AND (SpanCount = {v1:UInt64} AND (HourBucket >= fromUnixTimestamp64Milli({v2:Int64}) AND HourBucket < fromUnixTimestamp64Milli({v3:Int64})) AND LastSeen > fromUnixTimestamp64Milli({v4:Int64}) AND Sign = {v5:Int8} AND PointId = {v6:String} AND Role = {v7:String} AND Amount > {v8:Decimal(18, 6)} AND ToolCounts[{v9:String}] > {v10:UInt32})"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": 1,
          "v1": 3,
          "v10": 2,
          "v2": 1000,
          "v3": 2000,
          "v4": 500,
          "v5": -1,
          "v6": "pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp",
          "v7": "agent",
          "v8": 1.5,
          "v9": "bash",
        }
      `);
    });
  });

  describe("when a read merges an AggregateFunction state", () => {
    /** @scenario "An AggregateFunction state is read only through its merge function" */
    it("renders the state's -Merge function and types the merged value", () => {
      const built = clickhouseRead({ scope: single })
        .from(rollup)
        .select({
          trace: rollup.TraceId,
          cost: fn.argMaxMerge(rollup.TotalCost),
          roles: fn.argMaxMerge(rollup.RoleCosts),
          spend: fn.sumMerge(rollup.SpendNano),
          requests: fn.countMerge(rollup.Requests),
        })
        .groupBy(rollup.TraceId)
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT TraceId AS trace, argMaxMerge(TotalCost) AS cost, argMaxMerge(RoleCosts) AS roles, sumMerge(SpendNano) AS spend, countMerge(Requests) AS requests FROM metrics_rollup WHERE TenantId = {tenantId:String} GROUP BY TraceId"`,
      );
      expectTypeOf<
        ValueOfExpression<ReturnType<typeof fn.argMaxMerge<number, "metrics_rollup">>>
      >().toEqualTypeOf<number>();
      expectTypeOf(fn.argMaxMerge(rollup.RoleCosts)).toExtend<{
        readonly node: unknown;
      }>();
      // @ts-expect-error a sum merge does not read an argMax state
      fn.sumMerge(rollup.TotalCost);
      clickhouseRead({ scope: single })
        .from(rollup)
        .select({ trace: rollup.TraceId })
        // @ts-expect-error no bound value compares with a stored state
        .where(({ eq }) => eq(rollup.TotalCost, 3));
    });

    /** @scenario "An AggregateFunction state is read only through its merge function" */
    it("sums per-key maps and rebuilds the map from the tuple sumMap returns", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .select({
          roles: fn.mapFromArrays(
            fn.tupleElement(
              fn.sumMap(fn.mapKeys(runs.RoleTotals), fn.mapValues(runs.RoleTotals)),
              "0",
            ),
            fn.tupleElement(
              fn.sumMap(fn.mapKeys(runs.RoleTotals), fn.mapValues(runs.RoleTotals)),
              "1",
            ),
          ),
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT mapFromArrays(tupleElement(sumMap(mapKeys(RoleTotals), mapValues(RoleTotals)), 1), tupleElement(sumMap(mapKeys(RoleTotals), mapValues(RoleTotals)), 2)) AS roles FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
    });
  });

  describe("when a read calls a function that takes a lambda", () => {
    /** @scenario "A lambda's parameters are named by the builder and typed by the arrays it reads" */
    it("names each parameter, nested lambdas apart, and types it by its array", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .select(({ and, eq, ne }) => ({
          agents: fn.arrayStringConcat(
            fn.arrayMap(
              (agent) => fn.JSONExtractString(agent, "name"),
              fn.arrayFilter(
                (agent) =>
                  and(
                    eq(fn.JSONExtractString(agent, "role"), "agent"),
                    ne(fn.JSONExtractString(agent, "name"), ""),
                  ),
                fn.JSONExtractArrayRaw(fn.ifNull(runs.Metadata, "{}"), "agents"),
              ),
            ),
            " vs ",
          ),
          doubled: fn.arrayMap(
            (scores) => fn.arraySum(fn.arrayMap((score) => fn.multiply(score, 2), scores)),
            fn.mapValues(runs.RoleCosts),
          ),
          paired: fn.arrayExists(
            (id, role) => and(eq(role, "user"), fn.startsWith(id, "m")),
            runs["Messages.Id"],
            runs["Messages.Role"],
          ),
          ranked: fn.arrayReverseSortBy((score) => fn.ifNull(score, 0), runs["Evaluations.Score"]),
        }))
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT arrayStringConcat(arrayMap(__x0 -> JSONExtractString(__x0, {v0:String}), arrayFilter(__x1 -> (JSONExtractString(__x1, {v1:String}) = {v2:String} AND JSONExtractString(__x1, {v3:String}) != {v4:String}), JSONExtractArrayRaw(ifNull(Metadata, {v5:String}), {v6:String}))), {v7:String}) AS agents, arrayMap(__x2 -> arraySum(arrayMap(__x3 -> multiply(__x3, {v8:Float64}), __x2)), mapValues(RoleCosts)) AS doubled, arrayExists((__x4, __x5) -> (__x5 = {v9:String} AND startsWith(__x4, {v10:String})), \`Messages.Id\`, \`Messages.Role\`) AS paired, arrayReverseSort(__x6 -> ifNull(__x6, {v11:Float64}), \`Evaluations.Score\`) AS ranked FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": "name",
          "v1": "role",
          "v10": "m",
          "v11": 0,
          "v2": "agent",
          "v3": "name",
          "v4": "",
          "v5": "{}",
          "v6": "agents",
          "v7": " vs ",
          "v8": 2,
          "v9": "user",
        }
      `);
    });

    /** @scenario "A lambda's parameters are named by the builder and typed by the arrays it reads" */
    it("filters a map by its keys and refuses a parameter read outside its lambda", () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          events: fn.mapFilter((key) => fn.startsWith(key, "event."), spans.SpanAttributes),
        })
        .build();
      let leaked: Expression<string> | undefined;
      fn.arrayMap((name) => {
        leaked = fn.toString(name);
        return name;
      }, spans["Events.Name"]);

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT mapFilter((__x0, __x1) -> startsWith(__x0, {v0:String}), SpanAttributes) AS events FROM stored_spans WHERE TenantId = {tenantId:String}"`,
      );
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(spans)
            .select({ name: leaked ?? fn.toString(spans.SpanId) })
            .build(),
        ).kind,
      ).toBe("unsupported-operand");
      // @ts-expect-error a member of a string array is not a number to multiply
      fn.arrayMap((name) => fn.multiply(name, 2), spans["Events.Name"]);
    });
  });

  describe("when a read calls the catalogue functions", () => {
    /** @scenario "The census functions render with every value bound" */
    it("renders the array aggregates with a condition, the array first and the condition second", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .select(({ eq }) => ({
          total: fn.sumArrayIf(runs["Evaluations.Score"], eq(runs.TraceId, "t")),
          mean: fn.avgArrayIf(runs["Evaluations.Score"], eq(runs.TraceId, "t")),
          low: fn.minArrayIf(runs["Evaluations.Score"], eq(runs.TraceId, "t")),
          high: fn.maxArrayIf(runs["Evaluations.Score"], eq(runs.TraceId, "t")),
          ids: fn.uniqArrayIf(runs["Messages.Id"], eq(runs.TraceId, "t")),
          p50: fn.quantileExactArrayIf(0.5, runs["Evaluations.Score"], eq(runs.TraceId, "t")),
          p99: fn.quantileTDigestArrayIf(0.99, runs["Evaluations.Score"], eq(runs.TraceId, "t")),
        }))
        .build();

      expect(built.sql).toContain(
        "sumArrayIf(`Evaluations.Score`, TraceId = {v0:String}) AS total, avgArrayIf(`Evaluations.Score`, TraceId = {v1:String}) AS mean, minArrayIf(`Evaluations.Score`, TraceId = {v2:String}) AS low, maxArrayIf(`Evaluations.Score`, TraceId = {v3:String}) AS high, uniqArrayIf(`Messages.Id`, TraceId = {v4:String}) AS ids, quantileExactArrayIf(0.5)(`Evaluations.Score`, TraceId = {v5:String}) AS p50, quantileTDigestArrayIf(0.99)(`Evaluations.Score`, TraceId = {v6:String}) AS p99",
      );
    });

    it("refuses a quantile level outside 0 to 1 on the array-if forms", () => {
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(runs)
            .select(({ eq }) => ({
              p: fn.quantileExactArrayIf(1.5, runs["Evaluations.Score"], eq(runs.TraceId, "t")),
            })),
        ).kind,
      ).toBe("bad-constant");
    });

    /** @scenario "The census functions render with every value bound" */
    it("binds JSON paths, patterns, formats, units and time zones as values", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .select({
          status: fn.JSONExtractString(
            fn.ifNull(runs.Metadata, "{}"),
            "langwatch",
            "hooks",
            "setup",
            "status",
          ),
          raw: fn.JSONExtractRaw(fn.ifNull(runs.Metadata, "{}"), "parameters"),
          keys: fn.JSONExtractKeys(fn.ifNull(runs.Metadata, "{}")),
          cost: fn.JSONExtractFloat(fn.ifNull(runs.Metadata, "{}"), "totals", 1),
          labels: fn.JSONExtract(
            fn.ifNull(runs.Metadata, "{}"),
            column.array(column.string()),
            "labels",
          ),
          slug: fn.trimBoth(
            fn.replaceRegexpAll(fn.lowerUTF8(runs.ScenarioRunId), "[^\\p{L}\\p{N}]+", "-"),
            "-",
          ),
          key: fn.replaceOne(runs.ScenarioRunId, "run_", ""),
          label: fn.concat('"', runs.ScenarioRunId, fn.char(31)),
          day: fn.formatDateTime(runs.UpdatedAt, "%Y-%m-%d", "UTC"),
          week: fn.toStartOfWeek(runs.UpdatedAt, { mode: 1, timeZone: "Europe/Amsterdam" }),
          month: fn.toStartOfMonth(runs.UpdatedAt),
          minute: fn.toStartOfMinute(runs.UpdatedAt),
          lagMs: fn.dateDiff("millisecond", runs.UpdatedAt, fn.now64()),
          at: fn.toDateTime64(param.int64(1), 3),
          found: fn.positionCaseInsensitive(runs.ScenarioRunId, "RUN"),
          parts: fn.extractAll(runs.ScenarioRunId, "([a-z]+)"),
          all: fn.hasAll(runs["Messages.Id"], ["m1", "m2"]),
          zipped: fn.arrayZip(runs["Messages.Id"], runs["Messages.Role"]),
          positions: fn.arrayEnumerate(runs["Messages.Id"]),
          hashed: fn.cityHash64(runs.TraceId, param.uint64(7)),
          vote: fn.toInt32OrNull(runs.ScenarioRunId),
          number: fn.toFloat64OrZero(runs.ScenarioRunId),
          attempts: fn.toUInt16(param.uint32(0)),
          pairs: fn.map(["first", runs.ScenarioRunId], ["second", runs.TraceId]),
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT JSONExtractString(ifNull(Metadata, {v0:String}), {v1:String}, {v2:String}, {v3:String}, {v4:String}) AS status, JSONExtractRaw(ifNull(Metadata, {v5:String}), {v6:String}) AS raw, JSONExtractKeys(ifNull(Metadata, {v7:String})) AS keys, JSONExtractFloat(ifNull(Metadata, {v8:String}), {v9:String}, {v10:Int64}) AS cost, JSONExtract(ifNull(Metadata, {v11:String}), {v12:String}, {v13:String}) AS labels, trim(BOTH {v14:String} FROM replaceRegexpAll(lowerUTF8(ScenarioRunId), {v15:String}, {v16:String})) AS slug, replaceOne(ScenarioRunId, {v17:String}, {v18:String}) AS key, concat({v19:String}, ScenarioRunId, char({v20:UInt8})) AS label, formatDateTime(UpdatedAt, {v21:String}, {v22:String}) AS day, toStartOfWeek(UpdatedAt, 1, {v23:String}) AS week, toStartOfMonth(UpdatedAt) AS month, toStartOfMinute(UpdatedAt) AS minute, dateDiff({v24:String}, UpdatedAt, now64(3)) AS lagMs, toDateTime64({v25:Int64}, 3) AS at, positionCaseInsensitive(ScenarioRunId, {v26:String}) AS found, extractAll(ScenarioRunId, {v27:String}) AS parts, hasAll(\`Messages.Id\`, {v28:Array(String)}) AS all, arrayZip(\`Messages.Id\`, \`Messages.Role\`) AS zipped, arrayEnumerate(\`Messages.Id\`) AS positions, cityHash64(TraceId, {v29:UInt64}) AS hashed, toInt32OrNull(ScenarioRunId) AS vote, toFloat64OrZero(ScenarioRunId) AS number, toUInt16({v30:UInt32}) AS attempts, map({v31:String}, ScenarioRunId, {v32:String}, TraceId) AS pairs FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": "{}",
          "v1": "langwatch",
          "v10": 1,
          "v11": "{}",
          "v12": "labels",
          "v13": "Array(String)",
          "v14": "-",
          "v15": "[^\\p{L}\\p{N}]+",
          "v16": "-",
          "v17": "run_",
          "v18": "",
          "v19": """,
          "v2": "hooks",
          "v20": 31,
          "v21": "%Y-%m-%d",
          "v22": "UTC",
          "v23": "Europe/Amsterdam",
          "v24": "millisecond",
          "v25": 1,
          "v26": "RUN",
          "v27": "([a-z]+)",
          "v28": [
            "m1",
            "m2",
          ],
          "v29": 7,
          "v3": "setup",
          "v30": 0,
          "v31": "first",
          "v32": "second",
          "v4": "status",
          "v5": "{}",
          "v6": "parameters",
          "v7": "{}",
          "v8": "{}",
          "v9": "totals",
        }
      `);
    });

    /** @scenario "The census functions render with every value bound" */
    it("renders parameterised and combinator aggregates with checked constants", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .select(({ eq }) => ({
          distinct: fn.uniqUpTo(2, runs.TraceId),
          top: fn.topKArray(1, runs["Messages.Role"]),
          roles: fn.groupUniqArrayArray(runs["Messages.Role"], { max: 10 }),
          capped: fn.groupUniqArrayIf(runs.TraceId, eq(runs.TraceId, "t"), { max: 5 }),
          users: fn.uniqIf(runs.TraceId, eq(runs.TraceId, "t")),
          first: fn.argMinIf(runs.Metadata, runs.UpdatedAt, eq(runs.TraceId, "t")),
          p50: fn.quantileExactIf(
            0.5,
            fn.toUnixTimestamp64Milli(runs.UpdatedAt),
            eq(runs.TraceId, "t"),
          ),
          scores: fn.sumArray(runs["Evaluations.Score"]),
          best: fn.maxArray(runs["Evaluations.Score"]),
          ids: fn.uniqArray(runs["Messages.Id"]),
        }))
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT uniqUpTo(2)(TraceId) AS distinct, topKArray(1)(\`Messages.Role\`) AS top, groupUniqArrayArray(10)(\`Messages.Role\`) AS roles, groupUniqArrayIf(5)(TraceId, TraceId = {v0:String}) AS capped, uniqIf(TraceId, TraceId = {v1:String}) AS users, argMinIf(Metadata, UpdatedAt, TraceId = {v2:String}) AS first, quantileExactIf(0.5)(toUnixTimestamp64Milli(UpdatedAt), TraceId = {v3:String}) AS p50, sumArray(\`Evaluations.Score\`) AS scores, maxArray(\`Evaluations.Score\`) AS best, uniqArray(\`Messages.Id\`) AS ids FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
      expect(refusalOf(() => fn.uniqUpTo(101, runs.TraceId)).kind).toBe("bad-constant");
      expect(refusalOf(() => fn.toDateTime64(runs.UpdatedAt, 10)).kind).toBe("bad-constant");
    });
  });

  describe("when a read writes a CAST", () => {
    /** @scenario "A CAST names its type by a column type checked against the type grammar" */
    it("renders typed NULLs, typed empty arrays and conversions", () => {
      const built = clickhouseRead({ scope: single })
        .from(rollup)
        .select({
          reasoning: fn.nullAs(column.nullable(column.string())),
          traceIds: fn.emptyArrayAs(column.array(column.string())),
          status: fn.emptyArrayAs(column.array(column.lowCardinality(column.string()))),
          point: fn.cast(rollup.PointId, column.string()),
          cost: fn.nullAs(column.nullable(column.int64())),
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT CAST(NULL AS Nullable(String)) AS reasoning, CAST([] AS Array(String)) AS traceIds, CAST([] AS Array(LowCardinality(String))) AS status, CAST(PointId AS String) AS point, CAST(NULL AS Nullable(Int64)) AS cost FROM metrics_rollup WHERE TenantId = {tenantId:String}"`,
      );
    });

    /** @scenario "A CAST names its type by a column type checked against the type grammar" */
    it("refuses a type whose text is not a type, and a NULL or [] of the wrong kind", () => {
      const forged = (clickhouse: string): ColumnType<string> => ({
        clickhouse,
        paramType: "String",
      });

      for (const text of [
        "String) UNION ALL SELECT 1 --",
        "Nullable(String) AS x",
        "String'",
        "3",
        "Array(String",
      ]) {
        expect(refusalOf(() => fn.cast(rollup.PointId, forged(text))).kind).toBe(
          "unsupported-operand",
        );
      }
      const notNullable: ColumnType<string | null> = { clickhouse: "String", paramType: "String" };
      const notArray: ColumnType<readonly string[]> = { clickhouse: "String", paramType: "String" };
      expect(refusalOf(() => fn.nullAs(notNullable)).kind).toBe("unsupported-operand");
      expect(refusalOf(() => fn.emptyArrayAs(notArray)).kind).toBe("unsupported-operand");
    });
  });

  describe("when a read selects a column only some targets hold", () => {
    /** @scenario "A per-target select list reads the held column or its typed default" */
    it("reads the column where the target holds it and its typed default where it does not", () => {
      const holds = (name: string) => name !== "Criteria.Status";
      const criteria = (target: (name: string) => boolean) =>
        clickhouseRead({ scope: single })
          .from(runs)
          .select({
            criterion: fn.heldOr(runs["Criteria.Criterion"], {
              holds: target,
              otherwise: fn.emptyArrayAs(column.array(column.string())),
            }),
            status: fn.heldOr(runs["Criteria.Status"], {
              holds: target,
              otherwise: fn.emptyArrayAs(column.array(column.lowCardinality(column.string()))),
            }),
          })
          .build();

      expect(criteria(holds).sql).toMatchInlineSnapshot(
        `"SELECT \`Criteria.Criterion\` AS criterion, CAST([] AS Array(LowCardinality(String))) AS status FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
      expect(criteria(() => true).sql).toMatchInlineSnapshot(
        `"SELECT \`Criteria.Criterion\` AS criterion, \`Criteria.Status\` AS status FROM simulation_runs WHERE TenantId = {tenantId:String}"`,
      );
      fn.heldOr(runs["Criteria.Status"], {
        holds,
        // @ts-expect-error the default has the column's type
        otherwise: fn.nullAs(column.nullable(column.string())),
      });
    });
  });
});
