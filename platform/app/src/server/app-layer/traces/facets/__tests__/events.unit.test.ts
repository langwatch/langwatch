/**
 * @see specs/traces-v2/search.feature
 */
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

    describe("when the two halves of the facet are read", () => {
      it("counts names without touching the attributes map", () => {
        const { sql } = buildEventsFacetQuery(ctx());
        const names = sql.slice(sql.indexOf("FROM ("), sql.indexOf("AS names"));
        // The name counts are the part every sidebar load needs; reading the
        // map here would put every payload value back on that path.
        expect(names).toMatch(/arrayJoin\(`Events\.Name`\) AS name/);
        expect(names).not.toMatch(/Events\.Attributes/);
      });

      it("reads the map only for spans whose keys hold a metric", () => {
        const { sql } = buildEventsFacetQuery(ctx());
        const metrics = sql.slice(
          sql.indexOf("AS names"),
          sql.indexOf("AS metrics"),
        );
        // Gated on the keys subcolumn, which reaches PREWHERE and never opens
        // the values column, so granules with no metric-bearing span skip the
        // values entirely.
        // Explicit rather than left to optimize_move_to_prewhere, so the
        // saving holds whatever the optimizer settings are.
        expect(metrics).toMatch(
          /PREWHERE arrayExists\(\s*keys -> arrayExists\(k -> startsWith\(k, 'event\.metrics\.'\), keys\),\s*`Events\.Attributes`\.keys\s*\)/,
        );
      });

      /** @scenario Event metric values follow the same trace filter as the event name counts */
      it("scopes both halves to the filtered traces", () => {
        const scope = "TraceId IN (SELECT TraceId FROM scoped_traces)";
        const { sql, params } = buildEventsFacetQuery(
          ctx({ traceScope: { sql: scope, params: { scopeParam: "x" } } }),
        );
        const names = sql.slice(sql.indexOf("FROM ("), sql.indexOf("AS names"));
        const metrics = sql.slice(
          sql.indexOf("AS names"),
          sql.indexOf("AS metrics"),
        );
        // Each half reads stored_spans on its own, so a scope present in only
        // one of them would pair filtered name counts with unfiltered buckets.
        expect(names).toContain(scope);
        expect(metrics).toContain(scope);
        expect(params.scopeParam).toBe("x");
      });

      /** @scenario Event metric values follow the same trace filter as the event name counts */
      it("keeps the caller's predicate out of PREWHERE", () => {
        const scope = "TraceId IN (SELECT TraceId FROM scoped_traces)";
        const { sql } = buildEventsFacetQuery(
          ctx({ traceScope: { sql: scope, params: {} } }),
        );
        const metrics = sql.slice(
          sql.indexOf("AS names"),
          sql.indexOf("AS metrics"),
        );
        const prewhere = metrics.slice(
          metrics.indexOf("PREWHERE"),
          metrics.indexOf("WHERE TenantId"),
        );
        // Only the metric-key gate belongs there; the tenant, time and scope
        // predicates stay in WHERE as in every other facet builder.
        expect(prewhere).toMatch(/`Events\.Attributes`\.keys/);
        expect(prewhere).not.toContain("TenantId");
        expect(prewhere).not.toContain(scope);
      });

      it("keeps an event name with no metrics as an empty bucket list", () => {
        const { sql, settings } = buildEventsFacetQuery(ctx());
        expect(sql).toMatch(/LEFT JOIN/);
        expect(settings?.join_use_nulls).toBe("0");
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
