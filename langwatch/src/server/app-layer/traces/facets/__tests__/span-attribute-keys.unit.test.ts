import { describe, expect, it } from "vitest";
import { FACET_REGISTRY } from "../../facet-registry";
import {
  SPAN_ATTRIBUTE_KEYS_FACET,
  buildSpanAttributeKeysFacetQuery,
} from "../span-attribute-keys";

const baseCtx = {
  tenantId: "tenant-A",
  timeRange: { from: 1_700_000_000_000, to: 1_700_000_086_400_000 },
  limit: 50,
  offset: 0,
};

describe("SPAN_ATTRIBUTE_KEYS_FACET registration", () => {
  it("is a dynamic_keys facet against stored_spans", () => {
    expect(SPAN_ATTRIBUTE_KEYS_FACET.kind).toBe("dynamic_keys");
    expect(SPAN_ATTRIBUTE_KEYS_FACET.table).toBe("stored_spans");
    expect(SPAN_ATTRIBUTE_KEYS_FACET.group).toBe("span");
    expect(SPAN_ATTRIBUTE_KEYS_FACET.key).toBe("spanAttributeKeys");
  });

  it("registers exactly once into FACET_REGISTRY", () => {
    const matches = FACET_REGISTRY.filter(
      (d) => d.key === "spanAttributeKeys",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(SPAN_ATTRIBUTE_KEYS_FACET);
  });
});

describe("buildSpanAttributeKeysFacetQuery", () => {
  describe("when no prefix is supplied", () => {
    const query = buildSpanAttributeKeysFacetQuery(baseCtx);

    it("filters by tenant first (multitenancy invariant)", () => {
      // CLAUDE.md: every CH query MUST include `WHERE TenantId = ...` and
      // it should be the first predicate. Bug here = cross-tenant leakage.
      expect(query.sql).toMatch(/TenantId\s*=\s*\{tenantId:String\}/);
      const idxTenant = query.sql.indexOf("TenantId");
      const idxStartTime = query.sql.indexOf("StartTime");
      expect(idxTenant).toBeGreaterThan(-1);
      expect(idxTenant).toBeLessThan(idxStartTime);
    });

    it("scopes to the StartTime partition window for partition pruning", () => {
      // Without a partition-key range CH would scan every partition (incl.
      // S3 cold storage). See the ClickHouse mistakes table in CLAUDE.md.
      expect(query.sql).toContain("StartTime >=");
      expect(query.sql).toContain("StartTime <=");
    });

    it("reads the keys subcolumn directly via `.keys`, never the values side", () => {
      // The discover query returns *keys only* — values come later through
      // facetValues, which is what keeps this query bounded. We use the
      // `.keys` subcolumn instead of `mapKeys()` so ClickHouse skips
      // loading the value column entirely (saves ~50% of the per-row I/O
      // on Map(K, V) columns at scale).
      expect(query.sql).toContain("arrayJoin(SpanAttributes.keys)");
      expect(query.sql).not.toContain("mapValues");
      expect(query.sql).not.toContain("SpanAttributes.values");
    });

    it("short-circuits rows where SpanAttributes is empty", () => {
      // length() check kicks in before the arrayJoin so empty-attr granules
      // get pruned cleanly. Mirrors what `events.ts` does for Events.Name.
      expect(query.sql).toMatch(/length\(SpanAttributes\)\s*>\s*0/);
    });

    it("groups by key and orders by frequency", () => {
      expect(query.sql).toMatch(/GROUP BY key/);
      expect(query.sql).toMatch(/ORDER BY cnt DESC/);
    });

    it("emits the standard limit / offset binds", () => {
      expect(query.sql).toContain("LIMIT {limit:UInt32}");
      expect(query.sql).toContain("OFFSET {offset:UInt32}");
    });

    it("does not include an ILIKE prefix predicate", () => {
      expect(query.sql).not.toContain("ILIKE");
      expect(query.params).not.toHaveProperty("prefix");
    });

    it("binds tenantId, time range, limit, and offset", () => {
      expect(query.params).toEqual({
        tenantId: "tenant-A",
        timeFrom: 1_700_000_000_000,
        timeTo: 1_700_000_086_400_000,
        limit: 50,
        offset: 0,
      });
    });
  });

  describe("when a prefix is supplied for autocomplete", () => {
    const query = buildSpanAttributeKeysFacetQuery({
      ...baseCtx,
      prefix: "gen_ai",
    });

    it("adds a case-insensitive prefix predicate against the key", () => {
      expect(query.sql).toContain(
        "lower(key) ILIKE concat({prefix:String}, '%')",
      );
    });

    it("binds the prefix as a separate param (no string interpolation)", () => {
      expect(query.params.prefix).toBe("gen_ai");
      // Must not be inlined into the SQL — that would defeat parameterisation
      // and open a SQL-injection hole.
      expect(query.sql).not.toContain("'gen_ai'");
    });
  });

  describe("excludes empty keys from the result", () => {
    it("filters out '' rows in the outer WHERE", () => {
      const query = buildSpanAttributeKeysFacetQuery(baseCtx);
      expect(query.sql).toMatch(/WHERE key\s*!=\s*''/);
    });
  });
});
