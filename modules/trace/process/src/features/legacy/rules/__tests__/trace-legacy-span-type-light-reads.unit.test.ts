/**
 * The legacy trace filter's span type condition: span_analytics' plain `SpanType` where its
 * floor covers the window, the stored_spans map elsewhere.
 * @see specs/analytics/span-type-light-reads.feature
 */

import { describe, expect, it } from "vitest";

import { translateLegacyFilters } from "../trace-legacy-filter-conditions.rules.ts";

const DAY = 86_400_000;
const FLOOR_ISO = "2026-10-01T00:00:00.000Z";
const FLOOR_MS = Date.parse(FLOOR_ISO);
const FLOOR = { from: FLOOR_ISO, rebuilding: false };
const MAP_READ = "sp.SpanAttributes['langwatch.span.type']";

describe("given traces listed with a span type filter", () => {
  describe("when the floor covers the buffered window", () => {
    /** @scenario "The trace list span type condition reads span_analytics where the floor covers it" */
    it("checks span_analytics' SpanType inside the same window", () => {
      const { conditions } = translateLegacyFilters({
        filters: { "spans.type": ["llm"] },
        window: { startDate: FLOOR_MS + 3 * DAY, endDate: FLOOR_MS + 10 * DAY },
        spanAnalyticsFloor: FLOOR,
      });

      expect(conditions[0]).toContain("FROM span_analytics sa");
      expect(conditions[0]).toContain("sa.SpanType IN ({f0_values:Array(String)})");
      expect(conditions[0]).toContain(
        "sa.StartTime >= fromUnixTimestamp64Milli({spanWindowStart:UInt64})",
      );
      expect(conditions[0]).not.toContain(MAP_READ);
    });
  });

  describe("when the window opens before the floor", () => {
    /** @scenario "The trace list span type condition reads span_analytics where the floor covers it" */
    it("checks span_analytics from the floor on or the map before it", () => {
      const { conditions, params } = translateLegacyFilters({
        filters: { "spans.type": ["llm"] },
        window: { startDate: FLOOR_MS - DAY, endDate: FLOOR_MS + 10 * DAY },
        spanAnalyticsFloor: FLOOR,
      });

      expect(conditions[0]).toMatch(
        /^\(EXISTS \([\s\S]*FROM span_analytics sa[\s\S]*sa\.StartTime >= fromUnixTimestamp64Milli\(\{f0_from:Int64\}\)[\s\S]*\) OR EXISTS \([\s\S]*FROM stored_spans sp[\s\S]*sp\.StartTime < fromUnixTimestamp64Milli\(\{f0_from:Int64\}\)[\s\S]*\)\)$/,
      );
      expect(params.f0_from).toBe(FLOOR_MS);
    });

    /** @scenario "The trace list span type condition reads span_analytics where the floor covers it" */
    it("fences both halves on the outer trace's own tenant", () => {
      const { conditions } = translateLegacyFilters({
        filters: { "spans.type": ["llm"] },
        fenced: true,
        spanAnalyticsFloor: FLOOR,
      });

      expect(conditions[0]).toContain("{{tenantSet}} AND sa.TenantId = ts.TenantId");
      expect(conditions[0]).toContain("{{tenantSet}} AND sp.TenantId = ts.TenantId");
    });
  });

  describe("when there is no usable floor", () => {
    /** @scenario "A rebuilding, unknown or unparseable floor keeps stored_spans" */
    it("keeps the stored_spans map read", () => {
      for (const spanAnalyticsFloor of [undefined, null, { from: null, rebuilding: true }]) {
        const { conditions } = translateLegacyFilters({
          filters: { "spans.type": ["llm"] },
          window: { startDate: FLOOR_MS + 3 * DAY, endDate: FLOOR_MS + 10 * DAY },
          spanAnalyticsFloor,
        });

        expect(conditions[0]).toContain(MAP_READ);
        expect(conditions[0]).not.toContain("span_analytics");
      }
    });
  });
});
