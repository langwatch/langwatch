/**
 * ADR-202, "The typed builder": an array literal of typed expressions shares one element type;
 * conditions are Bool expressions a lambda body, an `if` or a selection takes outside a callback,
 * each value bound as a parameter; trace's LangWatch signals read is written with both.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { checkTenantScope } from "../../tenantGuard.ts";
import { column, cond, type Condition, type Expression, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError, type QueryBuilderViolation } from "../query-builder-error.ts";
import { clickhouseRead, readerStatementOf } from "../read.ts";
import { type ReaderScope, tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

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
    DurationMs: column.float64(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
  },
});

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "TraceId"],
  columns: { TenantId: column.string(), TraceId: column.string() },
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

const BOUND = String.raw`\{v\d+:String\}`;
const pattern = (text: string) => new RegExp(text.replaceAll("{s}", BOUND));

type Keys = Expression<readonly string[], "span_keys">;
const prefixed = (prefix: string) => (keys: Keys) =>
  fn.arrayExists((key) => fn.startsWith(key, prefix), keys);

/** main's SIGNAL_BUCKET_PREDICATES (span-storage repository), bucket by bucket. */
const SIGNALS: readonly (readonly [string, (keys: Keys) => Condition<"span_keys">])[] = [
  ["prompt", prefixed("langwatch.prompt.")],
  [
    "scenario",
    (keys) =>
      fn.arrayExists(
        (key) =>
          cond.or(fn.startsWith(key, "langwatch.scenario."), cond.eq(key, "scenario.run_id")),
        keys,
      ),
  ],
  [
    "user",
    (keys) =>
      fn.arrayExists(
        (key) => cond.or(cond.eq(key, "langwatch.user_id"), fn.startsWith(key, "langwatch.user.")),
        keys,
      ),
  ],
  [
    "thread",
    (keys) =>
      fn.arrayExists(
        (key) =>
          cond.or(
            cond.eq(key, "gen_ai.conversation.id"),
            cond.eq(key, "langgraph.thread_id"),
            fn.startsWith(key, "langwatch.thread."),
          ),
        keys,
      ),
  ],
  ["evaluation", prefixed("langwatch.evaluation")],
  ["rag", prefixed("langwatch.rag.")],
  ["metadata", prefixed("langwatch.metadata.")],
  ["genai", prefixed("gen_ai.")],
];

/** The signals read: each span's attribute keys once, then the buckets they fill, in order. */
function signalsOf({ scope }: { scope: ReaderScope }) {
  const spanKeys = clickhouseRead({ scope })
    .from(spans)
    .select({ SpanId: spans.SpanId, keys: fn.mapKeys(spans.SpanAttributes) })
    .where(({ eq }) => eq(spans.TraceId, "t1"))
    .latestVersion()
    .orderBy(spans.StartTime)
    .limit(10_000)
    .as("span_keys");
  return clickhouseRead({ scope })
    .from(spanKeys)
    .select({
      SpanId: spanKeys.SpanId,
      Signals: fn.arrayFilter(
        (signal) => cond.ne(signal, ""),
        fn.array(
          ...SIGNALS.map(([bucket, has]) => fn.if(has(spanKeys.keys), param.string(bucket), "")),
        ),
      ),
    })
    .build();
}

describe("typed query builder gaps, seventh census", () => {
  describe("given an array literal of typed expressions", () => {
    /** @scenario "An array literal of typed expressions shares one element type" */
    it("renders array(…) of its elements, a lambda over it binding values as its elements do", () => {
      const statement = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          Names: fn.arrayFilter(
            (name) => cond.ne(name, ""),
            fn.array(
              spans.SpanName,
              fn.if(cond.eq(spans.TraceId, "t1"), param.string("named"), ""),
            ),
          ),
        })
        .build();

      expect(statement.sql).toMatch(
        pattern(
          String.raw`^SELECT arrayFilter\(__x0 -> __x0 != {s}, array\(SpanName, if\(TraceId = {s}, {s}, {s}\)\)\) AS Names FROM stored_spans WHERE`,
        ),
      );
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining(["", "t1", "named"]));
      expect(statement.sql).not.toContain("'");
    });

    /** @scenario "An array literal of typed expressions shares one element type" */
    it("refuses elements binding as two types and an empty literal", () => {
      const mixed = () =>
        // @ts-expect-error a String and a Float64 element share no element type
        fn.array(spans.SpanName, spans.DurationMs);

      expect(violationOf(mixed)).toEqual({ kind: "mixed-array", types: ["String", "Float64"] });
      expect(violationOf(() => fn.array())).toEqual({ kind: "empty-array" });
      expect(fn.array(spans.SpanName, fn.toNullable(spans.TraceId)).binding).toEqual({
        paramType: "Array(String)",
        element: { paramType: "String" },
      });
    });
  });

  describe("given conditions written outside a read's callback", () => {
    /** @scenario "Conditions are Bool expressions outside a read's callback, binding their values" */
    it("renders a lambda body's OR of a prefix test and an equality with each value bound", () => {
      const statement = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          Scenario: fn.arrayExists(
            (key) =>
              cond.or(fn.startsWith(key, "langwatch.scenario."), cond.eq(key, "scenario.run_id")),
            fn.mapKeys(spans.SpanAttributes),
          ),
        })
        .build();

      expect(statement.sql).toMatch(
        pattern(
          String.raw`^SELECT arrayExists\(__x0 -> \(startsWith\(__x0, {s}\) OR __x0 = {s}\), mapKeys\(SpanAttributes\)\) AS Scenario FROM`,
        ),
      );
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining(["langwatch.scenario.", "scenario.run_id"]),
      );
      expect(statement.sql).not.toContain("'");
    });

    /** @scenario "Conditions are Bool expressions outside a read's callback, binding their values" */
    it("selects a condition as a value, takes one in an if and joins one in a where", () => {
      const statement = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          Slow: cond.and(cond.gt(spans.DurationMs, 1000), cond.not(cond.isNull(spans.SpanName))),
          Label: fn.if(cond.oneOf(spans.SpanName, ["a", "b"]), spans.SpanName, "other"),
        })
        .where(({ and, eq }) => and(eq(spans.TraceId, "t1"), cond.ne(spans.SpanName, "")))
        .build();

      expect(statement.sql).toMatch(
        pattern(
          String.raw`^SELECT \(DurationMs > \{v\d+:Float64\} AND NOT \(SpanName IS NULL\)\) AS Slow, if\(SpanName IN \(\{v\d+:Array\(String\)\}\), SpanName, {s}\) AS Label FROM stored_spans WHERE .*\(TraceId = {s} AND SpanName != {s}\)`,
        ),
      );
      expect(statement.sql).not.toContain("'");
    });

    /** @scenario "Conditions are Bool expressions outside a read's callback, binding their values" */
    it("refuses a value against a lambda parameter that has no binding, never writing it as text", () => {
      const pairs = fn.arrayZip(param.strings(["a"]), param.int64s([1]));

      expect(
        violationOf(() => fn.arrayExists((pair) => cond.eq(pair, ["a", 1] as const), pairs)),
      ).toEqual({ kind: "unsupported-operand", column: "lambdaParam" });
    });

    /** @scenario "Conditions are Bool expressions outside a read's callback, binding their values" */
    it("keeps a condition over another table's column out of a read, at compile time and at build", () => {
      const foreign = cond.eq(summaries.TraceId, "t1");
      const read = () =>
        clickhouseRead({ scope: single })
          .from(spans)
          // @ts-expect-error trace_summaries is not a table this read reads
          .select({ Foreign: foreign })
          .build();

      expect(violationOf(read)).toEqual({
        kind: "foreign-column",
        table: "trace_summaries",
        column: "TraceId",
      });
    });
  });

  describe("given an approximate distinct count over one or more expressions", () => {
    /** @scenario "An approximate distinct count takes one or more expressions of any type" */
    it("renders uniq of every expression given, counted as a UInt64", () => {
      const statement = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          Spans: fn.uniq(spans.TraceId, spans.SpanId),
          Traces: fn.uniq(spans.TraceId),
          Durations: fn.uniq(spans.DurationMs),
        })
        .build();

      expect(statement.sql).toMatch(
        /^SELECT uniq\(TraceId, SpanId\) AS Spans, uniq\(TraceId\) AS Traces, uniq\(DurationMs\) AS Durations FROM stored_spans WHERE /,
      );
      expect(fn.uniq(spans.TraceId, spans.SpanId).binding).toEqual({ paramType: "UInt64" });
    });

    /** @scenario "An approximate distinct count takes one or more expressions of any type" */
    it("keeps a count over a table the read does not read out, at compile time and at build", () => {
      const read = () =>
        clickhouseRead({ scope: single })
          .from(spans)
          // @ts-expect-error trace_summaries is not a table this read reads
          .select({ Foreign: fn.uniq(spans.TraceId, summaries.TraceId) })
          .build();

      expect(violationOf(read)).toEqual({
        kind: "foreign-column",
        table: "trace_summaries",
        column: "TraceId",
      });
    });
  });

  describe("given trace's LangWatch signals read built from an array literal and conditions", () => {
    /** @scenario "Trace's LangWatch signals read binds every value and passes the tenant guard" */
    it("binds every bucket name and key, and carries its tenant's predicate and setting", () => {
      const statement = signalsOf({ scope: single });

      expect(statement.sql).toMatch(
        pattern(
          String.raw`^SELECT SpanId, arrayFilter\(__x0 -> __x0 != {s}, array\(if\(arrayExists\(__x1 -> startsWith\(__x1, {s}\), keys\), {s}, {s}\), if\(arrayExists\(__x2 -> \(startsWith\(__x2, {s}\) OR __x2 = {s}\), keys\), {s}, {s}\), `,
        ),
      );
      expect(statement.sql).toMatch(
        / AS Signals FROM \(SELECT SpanId, mapKeys\(SpanAttributes\) AS keys FROM stored_spans WHERE /,
      );
      expect(statement.sql).toMatch(/ORDER BY StartTime ASC LIMIT 10000\) AS span_keys$/);
      expect(statement.sql).not.toContain("'");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining([
          ...SIGNALS.map(([bucket]) => bucket),
          "langgraph.thread_id",
          "langwatch.evaluation",
        ]),
      );
      expect(statement.settings[TENANT_IDS_SETTING]).toBe("proj_a");
    });

    /** @scenario "Trace's LangWatch signals read binds every value and passes the tenant guard" */
    it("passes the client's tenant guard under a single and a set scope", () => {
      const forOne = readerStatementOf({ statement: signalsOf({ scope: single }) });
      const forSet = readerStatementOf({ statement: signalsOf({ scope: set }) });

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
