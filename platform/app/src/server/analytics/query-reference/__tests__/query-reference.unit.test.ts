/**
 * Drift guards over the query reference.
 *
 * The reference's whole value is that a reader can trust it, so nothing in it
 * is reviewed where it can be executed instead. Every published LangWatchQL
 * statement goes through the real validator against the real catalog; every
 * published filter string goes through the real parser and the real translator.
 * An example that stops working fails here rather than teaching a query the
 * API refuses.
 *
 * The other half is coverage: a field the product gains has to appear, and the
 * syntax document has to name the prefixes the translator dispatches on.
 *
 * @see specs/analytics/query-reference.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LWQL_VIEW_CATALOG } from "~/server/analytics/lwql/catalog/lwqlViews";
import { lwqlAllowedTables } from "~/server/analytics/lwql/catalog/types";
import { LWQL_EXAMPLES } from "~/server/analytics/lwql/examples";
import { describeLangWatchQLSchema } from "~/server/analytics/lwql/schema";
import { validateLangWatchQL } from "~/server/analytics/lwql/validation/validate";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse/ast";
import { TRACE_FILTER_EXAMPLES } from "~/server/app-layer/traces/query-language/examples";
import { QUERY_SYNTAX_DOC } from "~/server/app-layer/traces/query-language/grammar";
import {
  DYNAMIC_PREFIXES,
  SEARCH_FIELDS,
} from "~/server/app-layer/traces/query-language/metadata";
import { parse } from "~/server/app-layer/traces/query-language/parse";
import { validateAst } from "~/server/app-layer/traces/query-language/queries";
import type { Protections } from "~/server/traces/protections";
import { describeQueryReference } from "../describe-query-reference";

const DATABASE = "analytics";

const EVERYTHING: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as Protections;

const NOTHING: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: false,
} as Protections;

const reference = (protections: Protections, lwqlEnabled = true) =>
  describeQueryReference({ protections, lwqlEnabled, database: DATABASE });

const MCP_FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../../../../../mcp/typescript/src/__tests__/fixtures/query-reference.json",
    import.meta.url,
  ),
);

describe("the LangWatchQL example library", () => {
  const allowedTables = lwqlAllowedTables({
    database: DATABASE,
    views: LWQL_VIEW_CATALOG,
  });

  describe("given the real catalog and no columns withheld", () => {
    /** @scenario "Every example is runnable as published" */
    it.each(
      LWQL_EXAMPLES.map((example) => [example.id, example] as const),
    )("validates %s", (_id, example) => {
      const result = validateLangWatchQL({
        sql: example.sql,
        allowedTables,
        gatedColumns: [],
        defaultDatabase: DATABASE,
      });
      const reasons = result.ok
        ? ""
        : result.violations
            .map((violation) => `${violation.code}: ${violation.message}`)
            .join("\n");
      expect(result.ok, reasons).toBe(true);
    });

    it.each(
      LWQL_EXAMPLES.map((example) => [example.id, example] as const),
    )("declares exactly the parameters %s binds", (_id, example) => {
      const result = validateLangWatchQL({
        sql: example.sql,
        allowedTables,
        gatedColumns: [],
        defaultDatabase: DATABASE,
      });
      if (!result.ok) throw new Error("the statement must validate first");
      expect([...result.parameters.map((p) => p.name)].sort()).toEqual(
        [...example.parameters.map((p) => p.name)].sort(),
      );
    });

    it("declares each parameter's type as the statement writes it", () => {
      for (const example of LWQL_EXAMPLES) {
        const result = validateLangWatchQL({
          sql: example.sql,
          allowedTables,
          gatedColumns: [],
          defaultDatabase: DATABASE,
        });
        if (!result.ok) throw new Error("the statement must validate first");
        for (const bound of result.parameters) {
          const declared = example.parameters.find(
            (candidate) => candidate.name === bound.name,
          );
          expect(declared?.type, `${example.id}.${bound.name}`).toBe(
            bound.type,
          );
        }
      }
    });
  });
});

describe("the trace filter example library", () => {
  describe("given the real parser and translator", () => {
    /** @scenario "Every example is runnable as published" */
    it.each(
      TRACE_FILTER_EXAMPLES.map((example) => [example.id, example] as const),
    )("parses, passes the semantic check and translates %s", (_id, example) => {
      const ast = parse(example.text);
      expect(validateAst(ast)).toBeNull();
      const translated = translateFilterToClickHouse(example.text, "tenant-a", {
        from: 0,
        to: 1,
      });
      expect(translated).not.toBeNull();
      expect(translated?.sql.length).toBeGreaterThan(0);
    });
  });

  describe("when a translated filter is combined with the legacy filter map", () => {
    /**
     * The legacy builder names every parameter `f<n>` plus a suffix
     * (`f0_values`, `f0_k0_canonical`) and two window bounds; the translator
     * names its own `<field>_<n>` plus a tenant and two time bounds. Both sets
     * land in one `query_params` object on the same statement, so a name
     * carrying two meanings would silently answer one of the two conditions
     * with the other's value.
     */
    /** @scenario "The filter's bound parameters cannot collide with the legacy filter's" */
    it("never emits a parameter the legacy builder also owns", () => {
      const legacyOwned = /^(f\d+_|spanWindowStart$|spanWindowEnd$)/;
      const legacySharedValue = new Set(["tenantId"]);
      for (const example of TRACE_FILTER_EXAMPLES) {
        const translated = translateFilterToClickHouse(
          example.text,
          "tenant-a",
          { from: 0, to: 1 },
        );
        for (const name of Object.keys(translated?.params ?? {})) {
          if (legacySharedValue.has(name)) continue;
          expect(legacyOwned.test(name), `${example.id}: ${name}`).toBe(false);
        }
      }
    });
  });
});

describe("the query reference", () => {
  describe("when built for a caller holding every permission", () => {
    const document = reference(EVERYTHING);

    /** @scenario "Every trace filter field the product knows is published" */
    it("publishes every trace filter field the product knows", () => {
      const published = new Set(
        document.traceFilter.fields.map((field) => field.name),
      );
      const missing = Object.keys(SEARCH_FIELDS).filter(
        (name) => !published.has(name),
      );
      expect(missing).toEqual([]);
    });

    /** @scenario "The open-ended attribute namespaces are published with their legacy spellings" */
    it("publishes every dynamic attribute prefix", () => {
      const published = new Set(
        document.traceFilter.dynamicPrefixes.map((entry) => entry.prefix),
      );
      const missing = DYNAMIC_PREFIXES.map((entry) => entry.prefix).filter(
        (prefix) => !published.has(prefix),
      );
      expect(missing).toEqual([]);
      expect(
        Object.fromEntries(
          document.traceFilter.dynamicPrefixes.map((entry) => [
            entry.prefix,
            entry.aliases,
          ]),
        ),
      ).toEqual({
        "trace.attribute.": ["attribute."],
        "span.attribute.": [],
        "event.attribute.": ["event."],
      });
    });

    /** @scenario "Example identifiers are unique and tagged by intent" */
    it("gives every example a unique identifier", () => {
      const ids = document.examples.map((example) => example.id);
      expect(ids.length).toBe(new Set(ids).size);
    });

    it("gives every example an intent and at least one tag", () => {
      for (const example of document.examples) {
        expect(example.intent, example.id).toBeTruthy();
        expect(example.tags.length, example.id).toBeGreaterThan(0);
      }
    });

    /** @scenario "The reference describes both query languages in one payload" */
    it("carries both languages' examples", () => {
      const languages = new Set(
        document.examples.map((example) => example.language),
      );
      expect([...languages].sort()).toEqual(["lwql", "trace-filter"]);
    });

    it("marks every example available", () => {
      expect(document.examples.filter((example) => !example.available)).toEqual(
        [],
      );
    });

    /** @scenario "Live values are not in the reference" */
    it("names the facets endpoint as where live values come from", () => {
      const paths = document.traceFilter.endpoints.map(
        (endpoint) => endpoint.path,
      );
      expect(paths).toContain("/api/traces/facets");
    });

    it("publishes no example calling an app-side function yet", () => {
      for (const example of document.examples) {
        expect(example.requires.functions, example.id).toEqual([]);
      }
    });

    /**
     * Embedded, not re-derived: a caller that fetches the reference must not
     * have to also fetch the schema to be sure the views agree.
     *
     */
    /** @scenario "The reference embeds the very schema the schema endpoint publishes" */
    it("embeds the very schema the schema endpoint publishes", () => {
      expect(document.lwql.schema).toEqual(
        describeLangWatchQLSchema({
          database: DATABASE,
          protections: EVERYTHING,
          views: LWQL_VIEW_CATALOG,
        }),
      );
    });

    /** @scenario "The reference describes both query languages in one payload" */
    it("answers the decision table with both languages", () => {
      const advice = document.decisionTable.map((row) => row.use).join(" ");
      expect(advice).toContain("LangWatchQL");
      expect(advice).toContain("Trace filter");
    });
  });

  describe("when built for a caller whose permissions withhold content and cost", () => {
    const document = reference(NOTHING);

    /** @scenario "An example a caller cannot run is published as unavailable" */
    it("marks the examples that read withheld columns unavailable", () => {
      const unavailable = document.examples
        .filter((example) => !example.available)
        .map((example) => example.id);
      expect(unavailable).toEqual(["lwql.cost-by-model", "lwql.keyset-export"]);
    });

    it("keeps an unavailable example's required permissions published", () => {
      const costExample = document.examples.find(
        (example) => example.id === "lwql.cost-by-model",
      );
      expect(costExample?.requires.gates).toEqual(["costs"]);
    });
  });

  describe("when LangWatchQL is closed to the project", () => {
    const document = reference(EVERYTHING, false);

    /** @scenario "The LangWatchQL section says whether the surface is open to this project" */
    it("reports the LangWatchQL surface disabled", () => {
      expect(document.lwql.enabled).toBe(false);
    });

    it("leaves the trace filter section intact", () => {
      expect(document.traceFilter.fields.length).toBeGreaterThan(0);
    });

    /**
     * A reader that branches on `available` per example, rather than on the
     * section flag, would otherwise be told a statement is runnable on a
     * project with no surface to run it on.
     */
    /**
     * `/schema` refuses a caller who cannot query, and this document embeds the
     * same catalog. Publishing it here would be that door standing open next
     * to the one that is shut.
     */
    /** @scenario "The LangWatchQL section says whether the surface is open to this project" */
    it("withholds the catalog rather than only flagging it", () => {
      expect(document.lwql.schema.views).toEqual([]);
      expect(document.lwql.schema.database).toBe(DATABASE);
    });

    /** @scenario "The LangWatchQL section says whether the surface is open to this project" */
    it("marks every SQL example unavailable", () => {
      const sql = document.examples.filter(
        (example) => example.language === "lwql",
      );
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.every((example) => !example.available)).toBe(true);
    });

    /** @scenario "The LangWatchQL section says whether the surface is open to this project" */
    it("leaves the filter examples runnable, which the surface does not gate", () => {
      const filters = document.examples.filter(
        (example) => example.language === "trace-filter",
      );
      expect(filters.every((example) => example.available)).toBe(true);
    });
  });
});

describe("given a deployment serving the views from another database", () => {
  const document = describeQueryReference({
    protections: EVERYTHING,
    lwqlEnabled: true,
    database: "lwql_test_db",
  });

  /**
   * The schema section already names every dataset under the deployment's own
   * qualifier. An example still naming `analytics.` would be a published
   * statement pointing at a database the caller cannot reach.
   */
  /** @scenario "Examples name the database this deployment serves" */
  it("qualifies every SQL example with that database", () => {
    const sql = document.examples.filter(
      (example) => example.language === "lwql",
    );
    expect(sql.length).toBeGreaterThan(0);
    for (const example of sql) {
      expect(example.text).not.toContain("analytics.");
    }
    expect(sql.some((example) => example.text.includes("lwql_test_db."))).toBe(
      true,
    );
  });

  /** @scenario "Examples name the database this deployment serves" */
  it("leaves the filter examples alone, which name no database", () => {
    const filters = document.examples.filter(
      (example) => example.language === "trace-filter",
    );
    for (const example of filters) {
      expect(example.text).not.toContain("lwql_test_db");
    }
  });
});

describe("the published trace filter syntax document", () => {
  /** @scenario "The published syntax document names the canonical attribute prefixes" */
  it.each(
    DYNAMIC_PREFIXES.map((entry) => entry.prefix),
  )("names the canonical prefix %s", (prefix) => {
    expect(QUERY_SYNTAX_DOC).toContain(prefix);
  });
});

describe("the MCP server's committed reference fixture", () => {
  /** @scenario "The MCP server's committed reference fixture matches the platform" */
  /** @scenario "The catalogued views regenerate byte-identical from the include lists" */
  it("equals the reference the platform builds", () => {
    const fixture: unknown = JSON.parse(
      readFileSync(MCP_FIXTURE_PATH, "utf-8"),
    );
    expect(fixture).toEqual(
      JSON.parse(JSON.stringify(reference(EVERYTHING))) as unknown,
    );
  });
});
