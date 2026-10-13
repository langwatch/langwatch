/**
 * @see specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import type { FacetQueryContext } from "../../../rules/trace-facet-registry.rules.ts";
import { EVENT_FACET } from "../clickhouse.trace-facet-events.repository.ts";

function ctx(overrides: Partial<FacetQueryContext> = {}): FacetQueryContext {
  return {
    timeRange: { from: 0, to: 1 },
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

describe("traceFacetEventsRepository.buildEventsFacetQuery", () => {
  describe("given an event facet request", () => {
    it("keys the facet value off the event name", () => {
      const { sql } = EVENT_FACET.queryBuilder(ctx());
      expect(sql).toMatch(/AS facet_value/);
      expect(sql).toMatch(/`Events\.Name`/);
    });

    describe("when the per-event metric aggregates are built", () => {
      /** @scenario "Expanding the thumbs_up_down row shows its vote values with counts" */
      it("zips Events.Name with Events.Attributes so metric entries scope to their own event", () => {
        const { sql } = EVENT_FACET.queryBuilder(ctx());
        expect(sql).toMatch(/arrayZip\(`Events\.Name`, `Events\.Attributes`\)/);
      });

      it("keeps only event.metrics.-prefixed attribute entries", () => {
        const { sql } = EVENT_FACET.queryBuilder(ctx());
        expect(sql).toMatch(/startsWith\(x\.1, 'event\.metrics\.'\)/);
      });

      it("emits capped, count-ranked metric_values buckets", () => {
        const { sql } = EVENT_FACET.queryBuilder(ctx());
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
        const { settings } = EVENT_FACET.queryBuilder(ctx());
        // The metric-key gate keeps the read small; the spill and the cap stay
        // as the backstop for a window where most spans do carry metrics.
        expect(settings?.max_bytes_before_external_group_by).toBeDefined();
        expect(settings?.max_memory_usage).toBeDefined();
      });
    });

    describe("when the two halves of the facet are read", () => {
      it("counts names without touching the attributes map", () => {
        const { sql } = EVENT_FACET.queryBuilder(ctx());
        const names = sql.slice(sql.indexOf("FROM ("), sql.indexOf("AS names"));
        // The name counts are the part every sidebar load needs; reading the
        // map here would put every payload value back on that path.
        expect(names).toMatch(/arrayJoin\(`Events\.Name`\) AS name/);
        expect(names).not.toMatch(/Events\.Attributes/);
      });

      it("reads the map only for spans whose keys hold a metric", () => {
        const { sql } = EVENT_FACET.queryBuilder(ctx());
        const metrics = sql.slice(sql.indexOf("AS names"), sql.indexOf("AS metrics"));
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
        // The filter is a trace_summaries predicate; the facet scopes it to
        // stored_spans as a membership test that carries the filter text.
        const scope = "Status = {scopeParam:String}";
        const { sql, params } = EVENT_FACET.queryBuilder(
          ctx({ filterWhere: { sql: scope, params: { scopeParam: "x" } } }),
        );
        const names = sql.slice(sql.indexOf("FROM ("), sql.indexOf("AS names"));
        const metrics = sql.slice(sql.indexOf("AS names"), sql.indexOf("AS metrics"));
        // Each half reads stored_spans on its own, so a scope present in only
        // one of them would pair filtered name counts with unfiltered buckets.
        expect(names).toContain(scope);
        expect(metrics).toContain(scope);
        expect(params.scopeParam).toBe("x");
      });

      /** @scenario Event metric values follow the same trace filter as the event name counts */
      it("keeps the caller's predicate out of PREWHERE", () => {
        const scope = "Status = {scopeParam:String}";
        const { sql } = EVENT_FACET.queryBuilder(
          ctx({ filterWhere: { sql: scope, params: { scopeParam: "x" } } }),
        );
        const metrics = sql.slice(sql.indexOf("AS names"), sql.indexOf("AS metrics"));
        const prewhere = metrics.slice(
          metrics.indexOf("PREWHERE"),
          metrics.indexOf("WHERE {{tenantScope"),
        );
        // Only the metric-key gate belongs there; the tenant, time and scope
        // predicates stay in WHERE as in every other facet builder.
        expect(prewhere).toMatch(/`Events\.Attributes`\.keys/);
        expect(prewhere).not.toContain("tenantScope");
        expect(prewhere).not.toContain(scope);
      });

      it("keeps an event name with no metrics as an empty bucket list", () => {
        const { sql, settings } = EVENT_FACET.queryBuilder(ctx());
        expect(sql).toMatch(/LEFT JOIN/);
        expect(settings?.join_use_nulls).toBe("0");
      });
    });

    describe("when a search prefix is given", () => {
      it("filters event names by the prefix", () => {
        const { sql, params } = EVENT_FACET.queryBuilder(ctx({ prefix: "thu" }));
        expect(sql).toMatch(/ILIKE concat\({prefix:String}, '%'\)/);
        expect(params.prefix).toBe("thu");
      });
    });
  });
});
