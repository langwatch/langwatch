/**
 * Every stock widget's query, as the catalogue stores it, passes the real LangWatchQL validator:
 * for a member who may see everything, and for one with gated columns, to whom a wildcard is
 * refused (so the sources condition may not be written as `SELECT *`).
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { validateLangWatchQL } from "./lwql-validate.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const database = "analytics";

// A committed copy of the stock SQL; the browser package's test keeps it equal to the catalogue.
const queries: readonly { label: string; sql: string }[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
    "utf8",
  ),
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

  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("passes the validator for a member who sees everything", () => {
    const refused = queries.flatMap(({ label, sql }) => {
      const codes = violationsOf(sql, EVERYTHING);
      return codes.length > 0 ? [`${label}: ${codes.join(",")}`] : [];
    });

    expect(refused).toEqual([]);
  });

  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("is never refused for a wildcard, whatever columns the member lacks", () => {
    const wildcard = queries.filter(({ sql }) =>
      violationsOf(sql, NO_CONTENT).includes("WILDCARD_NOT_ALLOWED"),
    );

    expect(wildcard.map(({ label }) => label)).toEqual([]);
  });
});
