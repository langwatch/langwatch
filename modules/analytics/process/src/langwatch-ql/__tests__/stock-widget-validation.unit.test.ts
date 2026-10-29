/**
 * Every stock widget's query, as the catalogue stores it, passes the real LangWatchQL validator:
 * for a member who may see everything, and for one with gated columns, to whom a wildcard is
 * refused (so the sources condition may not be written as `SELECT *`).
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 * @vitest-environment node
 */
import { fileURLToPath } from "node:url";

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { validateLangWatchQL } from "./lwql-validate.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const database = "analytics";

// The stock widgets live in the browser package, which this one does not depend on; loading them
// by a computed path keeps the two projects apart for the compiler and joins them for this proof.
const CATALOGUE = fileURLToPath(
  new URL("../../../../browser/src/features/dashboards/catalogue/index.ts", import.meta.url),
);
const catalogue = (await import(/* @vite-ignore */ CATALOGUE)) as {
  IMPLEMENTED_WIDGET_IDS: readonly string[];
  implementedWidget(id: string): { definition: { queries: { name: string; sql: string }[] } };
};
const queries = catalogue.IMPLEMENTED_WIDGET_IDS.flatMap((id) =>
  catalogue.implementedWidget(id).definition.queries.map(({ name, sql }) => ({
    label: `${id}/${name}`,
    sql,
  })),
);

function violationsOf(sql: string, protections: LangWatchQLProtections) {
  const result = validateLangWatchQL({
    sql,
    allowedTables: catalogShapes.allowedTables({ database, views: LWQL_VIEW_CATALOG }),
    gatedColumns: catalogShapes.gatedColumns({ protections, views: LWQL_VIEW_CATALOG }),
    defaultDatabase: database,
  });

  return result.ok ? [] : result.violations.map(({ code }) => code);
}

const EVERYTHING: LangWatchQLProtections = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
const NO_CONTENT: LangWatchQLProtections = {
  ...EVERYTHING,
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
};

describe("given the stock widgets of the catalogue", () => {
  it("has the queries of every stock widget to check", () => {
    expect(queries.length).toBeGreaterThan(100);
  });

  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("passes the validator for a member who sees everything", () => {
    const refused = queries.flatMap(({ label, sql }) => {
      const codes = violationsOf(sql, EVERYTHING);
      return codes.length > 0 ? [`${label}: ${codes.join(",")}`] : [];
    });

    expect(refused).toEqual([]);
  });

  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("is never refused for a wildcard, whatever columns the member lacks", () => {
    const wildcard = queries.filter(({ sql }) =>
      violationsOf(sql, NO_CONTENT).includes("WILDCARD_NOT_ALLOWED"),
    );

    expect(wildcard.map(({ label }) => label)).toEqual([]);
  });
});
