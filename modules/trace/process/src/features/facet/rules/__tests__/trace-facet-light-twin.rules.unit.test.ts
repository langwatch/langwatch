/**
 * Which table a batched span facet read scans.
 * @see specs/traces-v2/facet-light-twin.feature
 */

import { describe, expect, it } from "vitest";

import { CLICKHOUSE_FACET_CATALOG } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { batchedFacetSource } from "../trace-facet-light-twin.rules.ts";
import type { ExpressionCategoricalDef } from "../trace-facet-registry.rules.ts";

const FLOOR_MS = Date.parse("2026-10-01T00:00:00.000Z");
const DONE = { from: new Date(FLOOR_MS).toISOString(), rebuilding: false };

const spanFacets = CLICKHOUSE_FACET_CATALOG.registry.filter(
  (def): def is ExpressionCategoricalDef =>
    def.table === "stored_spans" && def.kind === "categorical" && "expression" in def,
);

function sourceFor({
  floor,
  fromMs,
  categoricals = spanFacets,
}: {
  floor: { from: string | null; rebuilding: boolean } | null;
  fromMs: number;
  categoricals?: ExpressionCategoricalDef[];
}) {
  return batchedFacetSource({
    catalog: CLICKHOUSE_FACET_CATALOG,
    table: "stored_spans",
    categoricals,
    ranges: [],
    floor,
    fromMs,
  });
}

describe("given the span facets of the ClickHouse catalogue", () => {
  it("covers span type, span name and span status, each with a light column", () => {
    expect(spanFacets.map((def) => def.key).toSorted()).toEqual([
      "spanName",
      "spanStatus",
      "spanType",
    ]);
  });

  describe("when the window starts at or after the span_analytics floor", () => {
    /** @scenario "A span facet pass inside the span_analytics floor reads span_analytics" */
    it("reads span_analytics on StartTime with its SpanType column", () => {
      const source = sourceFor({ floor: DONE, fromMs: FLOOR_MS });
      const spanType = spanFacets.find((def) => def.key === "spanType")!;

      expect(source.table).toBe("span_analytics");
      expect(source.timeColumn).toBe("StartTime");
      expect(source.expressionOf(spanType)).toBe("SpanType");
      for (const def of spanFacets) {
        expect(source.expressionOf(def), def.key).not.toContain("SpanAttributes");
      }
    });

    it("reads span_analytics on a whole install, where there is no floor", () => {
      expect(sourceFor({ floor: { from: null, rebuilding: false }, fromMs: 0 }).table).toBe(
        "span_analytics",
      );
    });
  });

  describe("when the window starts before the floor", () => {
    /** @scenario "A window that starts before the floor reads stored_spans" */
    it("reads stored_spans with the map expressions", () => {
      const source = sourceFor({ floor: DONE, fromMs: FLOOR_MS - 1 });
      const spanType = spanFacets.find((def) => def.key === "spanType")!;

      expect(source.table).toBe("stored_spans");
      expect(source.expressionOf(spanType)).toBe("SpanAttributes['langwatch.span.type']");
    });
  });

  describe("when span_analytics is rebuilding or its floor is unknown", () => {
    /** @scenario "While span_analytics is rebuilding the span facets read stored_spans" */
    it("reads stored_spans", () => {
      expect(sourceFor({ floor: { from: null, rebuilding: true }, fromMs: FLOOR_MS }).table).toBe(
        "stored_spans",
      );
      expect(sourceFor({ floor: null, fromMs: FLOOR_MS }).table).toBe("stored_spans");
    });

    /** @scenario "While span_analytics is rebuilding the span facets read stored_spans" */
    it("reads stored_spans when the floor does not parse, instead of failing", () => {
      const floor = { from: "not a time", rebuilding: false };

      expect(sourceFor({ floor, fromMs: FLOOR_MS }).table).toBe("stored_spans");
    });
  });

  describe("when a batch holds a facet without a light expression", () => {
    /** @scenario "A batch with a facet that has no light column reads its own table" */
    it("reads the facet's own table", () => {
      const withoutTwin: ExpressionCategoricalDef = {
        key: "spanCustom",
        kind: "categorical",
        label: "Custom",
        group: "span",
        table: "stored_spans",
        expression: "SpanAttributes['custom']",
      };
      const source = sourceFor({
        floor: DONE,
        fromMs: FLOOR_MS,
        categoricals: [...spanFacets, withoutTwin],
      });

      expect(source.table).toBe("stored_spans");
    });
  });
});
