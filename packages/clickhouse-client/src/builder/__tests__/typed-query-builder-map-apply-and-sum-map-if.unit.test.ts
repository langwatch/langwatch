/**
 * ADR-202, "The typed builder": main's agent-mark value cut (mapApply, substring) and its agent
 * traffic read (sumMapIf, arrayReverseSort over two arrays), rendered with every value bound.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { column, type ValueOfExpression } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
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
    ParentSpanId: column.nullable(column.string()),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.map({
      key: column.lowCardinality(column.string()),
      value: column.string(),
    }),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });

describe("the typed read builder, for map rewrites and per-key sums", () => {
  describe("when a read cuts each kept map value", () => {
    /** @scenario "A map's entries are rewritten by a lambda and a string is cut at bound offsets" */
    it("renders mapApply's lambda as a tuple and binds substring's offset and length", () => {
      const marks = fn.mapApply(
        (key, value) => [key, fn.substring(value, 1, 256)],
        fn.mapFilter((key) => fn.startsWith(key, "a2a."), spans.SpanAttributes),
      );
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({ marks, tail: fn.substring(spans.ParentSpanId, 3) })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT mapApply((__x0, __x1) -> tuple(__x0, substring(__x1, {v0:Int64}, {v1:Int64})), mapFilter((__x2, __x3) -> startsWith(__x2, {v2:String}), SpanAttributes)) AS marks, substring(ParentSpanId, {v3:Int64}) AS tail FROM stored_spans WHERE TenantId = {tenantId:String}"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": 1,
          "v1": 256,
          "v2": "a2a.",
          "v3": 3,
        }
      `);
    });

    /** @scenario "A map's entries are rewritten by a lambda and a string is cut at bound offsets" */
    it("types the map by the value the lambda returns and keeps a nullable string nullable", () => {
      const lengths = fn.mapApply(
        (key, value) => [fn.upper(key), fn.length(value)],
        spans.SpanAttributes,
      );
      const cut = fn.substring(spans.ParentSpanId, 1, 8);

      expectTypeOf<ValueOfExpression<typeof lengths>>().toEqualTypeOf<
        Readonly<Record<string, number>>
      >();
      expectTypeOf<ValueOfExpression<typeof cut>>().toEqualTypeOf<string | null>();
      expect(lengths.binding).toEqual({
        paramType: "Map(String, UInt64)",
        element: { paramType: "UInt64" },
      });
    });
  });

  describe("when a read keeps each group's most-used key", () => {
    /** @scenario "A conditional per-key sum is ordered by a lambda over two arrays" */
    it("renders sumMapIf over array literals and arrayReverseSort over its keys and sums", () => {
      const agentId = fn.mapGet(spans.SpanAttributes, "gen_ai.agent.id");
      const seen = clickhouseRead({ scope: single })
        .from(spans)
        .select({ seenId: agentId, spans: fn.count() })
        .groupBy(agentId)
        .as("seen");
      const built = clickhouseRead({ scope: single })
        .from(seen)
        .select(({ ne }) => {
          const ids = fn.sumMapIf(fn.array(seen.seenId), fn.array(seen.spans), ne(seen.seenId, ""));
          const ranked = fn.arrayReverseSortBy(
            (key, count) => fn.tuple(count, key),
            fn.tupleElement(ids, "0"),
            fn.tupleElement(ids, "1"),
          );
          return { agentId: fn.arrayElement(ranked, 1) };
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT arrayElement(arrayReverseSort((__x0, __x1) -> tuple(__x1, __x0), tupleElement(sumMapIf(array(seenId), array(spans), seenId != {v0:String}), 1), tupleElement(sumMapIf(array(seenId), array(spans), seenId != {v0:String}), 2)), {v1:Int64}) AS agentId FROM (SELECT SpanAttributes[{v2:String}] AS seenId, count() AS spans FROM stored_spans WHERE TenantId = {tenantId:String} GROUP BY SpanAttributes[{v2:String}]) AS seen"`,
      );
      expect(built.params).toMatchInlineSnapshot(`
        {
          "tenantId": "proj_a",
          "v0": "",
          "v1": 1,
          "v2": "gen_ai.agent.id",
        }
      `);
    });

    /** @scenario "A conditional per-key sum is ordered by a lambda over two arrays" */
    it("types each lambda parameter by its array and the result by the first array", () => {
      const keys = fn.array(spans.TraceId, spans.SpanId);
      const weights = fn.array(fn.length(spans.TraceId), fn.length(spans.SpanId));
      const sums = fn.sumMapIf(keys, weights, fn.notEmpty(spans.TraceId));
      const ordered = fn.arraySortBy(
        (key, weight) => {
          expectTypeOf<ValueOfExpression<typeof key>>().toEqualTypeOf<string>();
          expectTypeOf<ValueOfExpression<typeof weight>>().toEqualTypeOf<number>();
          return weight;
        },
        keys,
        weights,
      );

      expectTypeOf<ValueOfExpression<typeof sums>>().toEqualTypeOf<
        readonly [readonly string[], readonly number[]]
      >();
      expectTypeOf<ValueOfExpression<typeof ordered>>().toEqualTypeOf<readonly string[]>();
      expect(ordered.binding).toEqual(keys.binding);
    });
  });
});
