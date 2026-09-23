/**
 * The one reference document, built both ways: for a caller that reaches
 * LangWatchQL and for one that reaches only the filter language.
 * @see specs/analytics/query-reference.feature
 */

import {
  QUERY_EXAMPLE_INTENTS,
  queryReferenceSchema,
  type LangWatchQLProtections,
  type LangWatchQLSchema,
  type QueryReference,
} from "@langwatch/analytics-contract";
import { DYNAMIC_PREFIXES, SEARCH_FIELDS, TRACE_FILTER_EXAMPLES } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { validateLangWatchQL } from "../../langwatch-ql/__tests__/lwql-validate.ts";
import { DEFAULT_LWQL_DATABASE } from "../../services/langwatch-ql.service.ts";
import { LWQL_EXAMPLE_DATABASE, LWQL_EXAMPLES } from "../langwatch-ql-examples.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";
import { buildQueryReference } from "../query-reference.rules.ts";

const EVERYTHING_HELD: LangWatchQLProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

const EMPTY_SCHEMA: LangWatchQLSchema = {
  database: LWQL_EXAMPLE_DATABASE,
  functions: [],
  views: [],
  appFunctions: [],
};

const LIMITS = {
  maxStatementLength: 50_000,
  maxRowsReturned: 10_000,
  maxResultBytes: 8_000_000,
  maxExecutionTimeSeconds: 10,
};

function build(overrides: Partial<Parameters<typeof buildQueryReference>[0]> = {}): QueryReference {
  return buildQueryReference({
    protections: EVERYTHING_HELD,
    lwqlEnabled: true,
    database: LWQL_EXAMPLE_DATABASE,
    schema: EMPTY_SCHEMA,
    limits: LIMITS,
    traceFilterExamples: [],
    ...overrides,
  });
}

describe("the query reference", () => {
  /** @scenario 'The reference describes both query languages in one payload' */
  it("carries both languages and the decision table in one payload", () => {
    const reference = build();

    expect(queryReferenceSchema.parse(reference)).toBeTruthy();
    expect(reference.lwql.endpoints.map((endpoint) => endpoint.path)).toContain("/api/v1/query");
    expect(reference.lwql.limits.maxStatementLength).toBe(LIMITS.maxStatementLength);
    expect(reference.traceFilter.syntax.length).toBeGreaterThan(0);
    expect(reference.traceFilter.endpoints.map((endpoint) => endpoint.path)).toContain(
      "/api/traces/search",
    );
    expect(reference.decisionTable.length).toBeGreaterThan(0);
    for (const row of reference.decisionTable) {
      expect(row.when.length).toBeGreaterThan(0);
      expect(row.use.length).toBeGreaterThan(0);
      expect(row.why.length).toBeGreaterThan(0);
    }
  });

  /** @scenario 'Every trace filter field the product knows is published' */
  it("publishes every field in the filter registry with its label, type and group", () => {
    const published = build().traceFilter.fields;

    expect(published.map((field) => field.name).toSorted()).toEqual(
      Object.keys(SEARCH_FIELDS).toSorted(),
    );
    for (const field of published) {
      const meta = SEARCH_FIELDS[field.name]!;
      expect(field.label).toBe(meta.label);
      expect(field.valueType).toBe(meta.valueType);
      expect(field.group).toBe(meta.group ?? null);
    }
  });

  /** @scenario 'The open-ended attribute namespaces are published with their legacy spellings' */
  it("publishes the canonical prefixes with the spellings still accepted", () => {
    const prefixes = build().traceFilter.dynamicPrefixes;
    const byPrefix = new Map(prefixes.map((prefix) => [prefix.prefix, prefix]));

    expect(prefixes.map((prefix) => prefix.prefix).toSorted()).toEqual(
      DYNAMIC_PREFIXES.map((prefix) => prefix.prefix).toSorted(),
    );
    expect(byPrefix.get("trace.attribute.")?.aliases).toEqual(["attribute."]);
    expect(byPrefix.get("event.attribute.")?.aliases).toEqual(["event."]);
    expect(byPrefix.get("span.attribute.")?.aliases).toEqual([]);
  });

  /** @scenario 'Live values are not in the reference' */
  it("names the facets endpoint rather than inlining what a field holds", () => {
    const reference = build();
    const facets = reference.traceFilter.endpoints.find(
      (endpoint) => endpoint.path === "/api/traces/facets",
    );

    // A static vocabulary is a closed set the product itself defines; a value
    // read from this project's traces would be tenant data. A free-text or
    // existence field has no value set for the facets endpoint to list.
    expect(facets).toBeDefined();
    expect(
      reference.traceFilter.fields
        .filter((field) => field.valueType === "text" || field.valueType === "existence")
        .map((field) => field.facetable),
    ).not.toContain(true);
    expect(
      reference.traceFilter.fields.flatMap((field) =>
        field.knownValues.filter((value) => typeof value !== "string"),
      ),
    ).toEqual([]);
  });

  /** @scenario 'Every example is runnable as published' */
  it("publishes only statements the validator admits, with every bound parameter declared", () => {
    const policy = {
      allowedTables: LWQL_VIEW_CATALOG.map((view) => `${LWQL_EXAMPLE_DATABASE}.${view.name}`),
      gatedColumns: [] as readonly string[],
      heldPermissions: ["input", "output", "costs"] as readonly string[],
      defaultDatabase: LWQL_EXAMPLE_DATABASE,
    };

    for (const example of LWQL_EXAMPLES) {
      const result = validateLangWatchQL({ sql: example.sql, ...policy });

      expect(result.ok ? [] : result.violations.map((violation) => violation.code)).toEqual([]);
      if (!result.ok) continue;

      expect(result.parameters.map((parameter) => parameter.name).toSorted()).toEqual(
        example.parameters.map((parameter) => parameter.name).toSorted(),
      );
      for (const parameter of example.parameters) {
        expect(result.parameters.find((bound) => bound.name === parameter.name)?.type).toBe(
          parameter.type,
        );
      }
    }
  });

  /** @scenario 'Example identifiers are unique and tagged by intent' */
  it("gives every example a unique identifier, an intent and at least one tag", () => {
    const { examples } = build();
    const ids = examples.map((example) => example.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const example of examples) {
      expect(QUERY_EXAMPLE_INTENTS).toContain(example.intent);
      expect(example.tags.length).toBeGreaterThan(0);
    }
  });

  /** @scenario 'An example a caller cannot run is published as unavailable' */
  it("publishes an example the caller cannot run, with the permission that unlocks it", () => {
    const withheld = build({
      protections: { ...EVERYTHING_HELD, canSeeCosts: false },
    });
    const costly = withheld.examples.filter((example) => example.requires.gates.includes("costs"));

    expect(costly.length).toBeGreaterThan(0);
    for (const example of costly) {
      expect(example.available).toBe(false);
      expect(example.requires.gates).toContain("costs");
    }
  });

  /** @scenario 'The LangWatchQL section says whether the surface is open to this project' */
  it("reports the LangWatchQL half closed without touching the filter half", () => {
    const open = build();
    const closed = build({ lwqlEnabled: false });

    expect(closed.lwql.enabled).toBe(false);
    expect(closed.examples.every((example) => example.available === false)).toBe(true);
    expect(closed.traceFilter).toEqual(open.traceFilter);
  });

  /** @scenario 'A key entitled only to traces still reads the filter vocabulary' */
  it("answers a traces-only key with the filter half in full and no catalogue", () => {
    const reference = build({ lwqlEnabled: false, schema: EMPTY_SCHEMA });

    expect(reference.traceFilter.fields.length).toBe(Object.keys(SEARCH_FIELDS).length);
    expect(reference.lwql.schema.views).toEqual([]);
    expect(reference.lwql.schema.appFunctions).toEqual([]);
    expect(reference.lwql.endpoints.length).toBeGreaterThan(0);
  });

  /** @scenario 'Examples name the database this deployment serves' */
  it("names the database this deployment serves in every published statement", () => {
    const elsewhere = build({ database: "lw_analytics" });

    for (const example of elsewhere.examples.filter((example) => example.language === "lwql")) {
      expect(example.text).not.toMatch(new RegExp(`(?<![\\w])${LWQL_EXAMPLE_DATABASE}\\.`));
      expect(example.text).toContain("lw_analytics.");
    }
  });

  it("writes its examples against the database the deployment defaults to", () => {
    expect(LWQL_EXAMPLE_DATABASE).toBe(DEFAULT_LWQL_DATABASE);
  });

  it("publishes no example calling an app-side function yet", () => {
    for (const example of build({ traceFilterExamples: TRACE_FILTER_EXAMPLES }).examples) {
      expect(example.requires.functions, example.id).toEqual([]);
    }
  });

  it("withholds exactly the cost and content examples from a caller who holds neither", () => {
    const withheld = build({
      protections: { canSeeCosts: false, canSeeCapturedInput: false, canSeeCapturedOutput: false },
    });

    expect(withheld.examples.filter((example) => !example.available).map((e) => e.id)).toEqual([
      "lwql.cost-by-model",
      "lwql.keyset-export",
    ]);
  });

  /** @scenario 'Examples name the database this deployment serves' */
  it("leaves the filter examples alone, which name no database", () => {
    const elsewhere = build({
      database: "lwql_test_db",
      traceFilterExamples: TRACE_FILTER_EXAMPLES,
    });
    const filters = elsewhere.examples.filter((example) => example.language === "trace-filter");

    expect(filters.length).toBeGreaterThan(0);
    for (const example of filters) expect(example.text).not.toContain("lwql_test_db");
  });
});

describe("the published trace filter syntax document", () => {
  /** @scenario 'The published syntax document names the canonical attribute prefixes' */
  it.each(DYNAMIC_PREFIXES.map((entry) => entry.prefix))(
    "names the canonical prefix %s",
    (prefix) => {
      expect(build().traceFilter.syntax).toContain(prefix);
    },
  );
});
