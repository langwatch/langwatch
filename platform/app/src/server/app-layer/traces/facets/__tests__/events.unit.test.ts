import { describe, expect, it } from "vitest";
import type { FacetQueryContext } from "../../facet-registry";
import { buildEventsFacetQuery } from "../events";

function ctx(overrides: Partial<FacetQueryContext> = {}): FacetQueryContext {
  return {
    tenantId: "project_test",
    timeRange: { from: 0, to: 1 },
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

describe("buildEventsFacetQuery", () => {
  describe("given an event facet request", () => {
    it("keys the facet value off the event name", () => {
      const { sql } = buildEventsFacetQuery(ctx());
      expect(sql).toMatch(/AS facet_value/);
      expect(sql).toMatch(/`Events\.Name`/);
    });

    describe("when the per-event metric aggregates are built", () => {
      /** @scenario "Expanding the thumbs_up_down row shows its vote values with counts" */
      it("zips Events.Name with Events.Attributes so metric entries scope to their own event", () => {
        const { sql } = buildEventsFacetQuery(ctx());
        expect(sql).toMatch(/arrayZip\(`Events\.Name`, `Events\.Attributes`\)/);
      });

      it("keeps only event.metrics.-prefixed attribute entries", () => {
        const { sql } = buildEventsFacetQuery(ctx());
        expect(sql).toMatch(/startsWith\(x\.1, 'event\.metrics\.'\)/);
      });

      it("emits capped, count-ranked metric_values buckets", () => {
        const { sql } = buildEventsFacetQuery(ctx());
        // sumMap tallies (key SEP value) -> count in one pass per event name;
        // the outer SELECT ranks by count desc and caps the list so a
        // metric-happy tenant can't balloon the discover payload.
        expect(sql).toMatch(/sumMap\(/);
        expect(sql).toMatch(/arrayReverseSort\(/);
        expect(sql).toMatch(/AS metric_values/);
        expect(sql).toMatch(/1,\s*10\s*\)\s*AS metric_values/);
      });

      /** @scenario "Expanding the thumbs_up_down row shows its vote values with counts" */
      it("guards the scan with the key-discovery memory settings", () => {
        const { settings } = buildEventsFacetQuery(ctx());
        // Same unbounded Events.Attributes flatten that tripped
        // MEMORY_LIMIT_EXCEEDED for the key-discovery facets — the spill +
        // cap guard is non-negotiable here.
        expect(settings?.max_bytes_before_external_group_by).toBeDefined();
        expect(settings?.max_memory_usage).toBeDefined();
      });
    });

    describe("when a search prefix is given", () => {
      it("filters event names by the prefix", () => {
        const { sql, params } = buildEventsFacetQuery(ctx({ prefix: "thu" }));
        expect(sql).toMatch(/ILIKE concat\({prefix:String}, '%'\)/);
        expect(params.prefix).toBe("thu");
      });
    });
  });
});
