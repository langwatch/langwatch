import { describe, expect, it } from "vitest";
import {
  FACET_REGISTRY,
  TABLE_TIME_COLUMNS,
  type FacetDefinition,
} from "../../facet-registry";
import { SEARCH_FIELDS } from "../../query-language/metadata";

const baseCtx = {
  tenantId: "tenant-X",
  timeRange: { from: 1_700_000_000_000, to: 1_700_000_086_400_000 },
  limit: 50,
  offset: 0,
};

const queryBuilders = FACET_REGISTRY.filter(
  (def): def is Extract<
    FacetDefinition,
    { queryBuilder: (...args: unknown[]) => unknown }
  > => "queryBuilder" in def && typeof def.queryBuilder === "function",
);

describe("SearchBar / sidebar parity", () => {
  // Dynamic-keys facets are surfaced in the search bar via the
  // `trace.attribute.<key>` / `span.attribute.<key>` dynamic prefixes,
  // not as a top-level field — they don't need a SEARCH_FIELDS entry.
  const SEARCH_BAR_EXEMPT = new Set<FacetDefinition["kind"]>(["dynamic_keys"]);

  it.each(
    FACET_REGISTRY.filter((d) => !SEARCH_BAR_EXEMPT.has(d.kind)).map((d) => [
      d.key,
      d.label,
    ]),
  )(
    "[%s] is registered in SEARCH_FIELDS so the search bar dropdown can suggest it",
    (key) => {
      expect(
        SEARCH_FIELDS[key],
        `facet "${key}" exists in FACET_REGISTRY but not SEARCH_FIELDS — the search bar won't surface it`,
      ).toBeDefined();
    },
  );
});

describe("FACET_REGISTRY shape", () => {
  it("contains no duplicate keys", () => {
    const seen = new Map<string, number>();
    for (const def of FACET_REGISTRY) {
      seen.set(def.key, (seen.get(def.key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    expect(dupes, `duplicate facet keys: ${dupes}`).toEqual([]);
  });

  describe("label casing", () => {
    // Acronyms are expected to stay uppercase mid-label ("Contains AI", an
    // eventual "API key", etc.). Detect them with a lookbehind so the rule
    // catches accidental Title Case ("Span Type") but not legitimate
    // acronyms or unit suffixes like "(ms)".
    const TITLE_CASE_OFFENDER = /\s([A-Z])(?=[a-z])/;
    const ACRONYM_ALLOWLIST = new Set(["AI"]);

    it.each(FACET_REGISTRY.map((d) => [d.key, d.label]))(
      "[%s] label '%s' is sentence case (no Title Case Words)",
      (_key, label) => {
        // Strip allowlisted acronyms so they don't trip the regex even
        // though they're uppercase.
        const stripped = [...ACRONYM_ALLOWLIST].reduce(
          (acc, acronym) => acc.replace(acronym, ""),
          label,
        );
        const match = stripped.match(TITLE_CASE_OFFENDER);
        expect(
          match,
          `label "${label}" looks Title Case — expected sentence case`,
        ).toBeNull();
      },
    );

    it("does not stamp '(ms)' / '(s)' style units onto duration labels", () => {
      // Cell formatters humanise the values; the label should read as
      // prose, not a column-header annotation.
      for (const def of FACET_REGISTRY) {
        expect(def.label).not.toMatch(/\(\s*m?s\s*\)/);
      }
    });
  });

  it("only references known tables", () => {
    const known = Object.keys(TABLE_TIME_COLUMNS);
    for (const def of FACET_REGISTRY) {
      expect(known, `${def.key} on unknown table`).toContain(def.table);
    }
  });

  it("declares the canonical span-level facets in registry order (`spanType` first)", () => {
    const spanKeys = FACET_REGISTRY.filter((d) => d.group === "span").map(
      (d) => d.key,
    );
    expect(spanKeys).toEqual(
      expect.arrayContaining([
        "spanType",
        "event",
        "spanName",
        "spanStatus",
        "spanAttributeKeys",
      ]),
    );
  });

  describe("Subjects-axis facets", () => {
    it("registers `customer` as an expression-categorical on trace_summaries", () => {
      const def = FACET_REGISTRY.find((d) => d.key === "customer");
      expect(def?.kind).toBe("categorical");
      expect(def?.table).toBe("trace_summaries");
      // Auto-derived filter handler relies on this being an expression-form.
      expect(def && "expression" in def && def.expression).toBe(
        "Attributes['langwatch.customer_id']",
      );
    });

    it("registers `scenarioRun` so the sidebar can discover scenario-run IDs", () => {
      const def = FACET_REGISTRY.find((d) => d.key === "scenarioRun");
      expect(def?.kind).toBe("categorical");
      expect(def?.table).toBe("trace_summaries");
      expect(def && "expression" in def && def.expression).toBe(
        "Attributes['scenario.run_id']",
      );
    });

    it("keeps `user` and `conversation` as registry-driven categoricals", () => {
      const user = FACET_REGISTRY.find((d) => d.key === "user");
      const convo = FACET_REGISTRY.find((d) => d.key === "conversation");
      expect(user?.kind).toBe("categorical");
      expect(convo?.kind).toBe("categorical");
    });
  });

  describe("event-attribute discovery", () => {
    it("registers `eventAttributeKeys` as a dynamic_keys facet on stored_spans", () => {
      const def = FACET_REGISTRY.find((d) => d.key === "eventAttributeKeys");
      expect(def?.kind).toBe("dynamic_keys");
      expect(def?.table).toBe("stored_spans");
    });

    it("emits a query that flattens the per-event attribute maps", () => {
      const def = FACET_REGISTRY.find((d) => d.key === "eventAttributeKeys");
      // Must double-arrayJoin: outer for events, inner for map keys per event.
      // Without both, distinct keys would collapse onto the first event only.
      if (!def || def.kind !== "dynamic_keys") {
        throw new Error("expected eventAttributeKeys to be dynamic_keys");
      }
      const { sql } = def.queryBuilder(baseCtx);
      expect(sql).toContain("Events.Attributes");
      expect(sql).toMatch(/arrayJoin\s*\(\s*mapKeys\s*\(\s*arrayJoin/);
    });
  });
});

describe("each query-builder facet", () => {
  it.each(queryBuilders.map((def) => [def.key, def]))(
    "[%s] pins the query to TenantId before any other predicate",
    (_key, def) => {
      const { sql } = def.queryBuilder(baseCtx);
      const idxTenant = sql.indexOf("TenantId");
      expect(
        idxTenant,
        "every facet query must include TenantId — multitenancy invariant",
      ).toBeGreaterThan(-1);
      // No other predicate should land before TenantId in the WHERE clause.
      // We use a coarse check: TenantId must appear before the first
      // partition-key (`OccurredAt` / `StartTime` / `ScheduledAt`) reference.
      for (const col of Object.values(TABLE_TIME_COLUMNS)) {
        const idxCol = sql.indexOf(col);
        if (idxCol > -1) {
          expect(idxTenant).toBeLessThan(idxCol);
        }
      }
    },
  );

  it.each(queryBuilders.map((def) => [def.key, def]))(
    "[%s] binds the standard tenant + time + limit + offset params",
    (_key, def) => {
      const { params } = def.queryBuilder(baseCtx);
      expect(params).toMatchObject({
        tenantId: "tenant-X",
        timeFrom: 1_700_000_000_000,
        timeTo: 1_700_000_086_400_000,
        limit: 50,
        offset: 0,
      });
    },
  );

  it.each(queryBuilders.map((def) => [def.key, def]))(
    "[%s] never inlines an autocomplete prefix into SQL (parameterised)",
    (_key, def) => {
      const { sql, params } = def.queryBuilder({
        ...baseCtx,
        prefix: "needle",
      });
      // Either the builder ignores `prefix` entirely, or it binds it as a
      // {prefix:String} param. Inlining the literal string would mean a
      // SQL-injection hazard.
      expect(sql).not.toContain("'needle'");
      if ("prefix" in params) {
        expect(params.prefix).toBe("needle");
      }
    },
  );
});
