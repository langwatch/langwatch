/** Every table in the committed ClickHouse columns manifest must be accounted for. */

import { describe, expect, it } from "vitest";

import { LWQL_COLUMNS_MANIFEST } from "../lwql-columns-manifest.rules.ts";
import {
  LWQL_DERIVED_CATALOG,
  LWQL_HAND_WRITTEN_SOURCE_TABLES,
} from "../lwql-derived-view-catalog.rules.ts";
import { LWQL_CATALOG_SKIPPED_TABLES, deriveSkipReason } from "../lwql-skipped-tables.rules.ts";
// `lwqlViews` is imported before `derivedViews` deliberately: both sit in one ESM cycle (lwqlViews
// -> derivedViews -> overrides/coding -> provisioning/catalogStatements -> lwqlViews), and
// whichever of the two this file touches first becomes the cycle's entry point.
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const manifestTableNames = LWQL_COLUMNS_MANIFEST.tables.map((table) => table.name);

// Widened to a plain string array: manifest table names are dynamic strings,
// not the literal union `LWQL_HAND_WRITTEN_SOURCE_TABLES` carries, and
// `.includes` on a `readonly [...] as const` tuple requires an argument of
// that exact literal union.
const handWritten: readonly string[] = LWQL_HAND_WRITTEN_SOURCE_TABLES;
const derived = LWQL_DERIVED_CATALOG;
const derivedSourceTables = new Set(derived.map((view) => view.sourceTable));

const HAND_WRITTEN_TABLE_COUNT = 11;
const DERIVED_TABLE_COUNT = 29;
const SKIPPED_TABLE_COUNT = 5;

describe("given every table in the committed ClickHouse columns manifest", () => {
  it("is hand-written, derived, or skipped-with-a-reason — exactly once", () => {
    for (const table of manifestTableNames) {
      const buckets = [
        handWritten.includes(table),
        derivedSourceTables.has(table),
        deriveSkipReason(table, LWQL_CATALOG_SKIPPED_TABLES) !== undefined,
      ].filter(Boolean).length;
      expect(buckets, `"${table}" should land in exactly one bucket`).toBe(1);
    }
  });

  it("pins the current split with literal counts, so drift is visible", () => {
    const handWrittenChTables = manifestTableNames.filter((table) => handWritten.includes(table));
    const skippedTables = manifestTableNames.filter(
      (table) => deriveSkipReason(table, LWQL_CATALOG_SKIPPED_TABLES) !== undefined,
    );

    expect(handWrittenChTables.length).toBe(HAND_WRITTEN_TABLE_COUNT);
    expect(derived.length).toBe(DERIVED_TABLE_COUNT);
    expect(skippedTables.length).toBe(SKIPPED_TABLE_COUNT);
    expect(handWrittenChTables.length + derived.length + skippedTables.length).toBe(
      manifestTableNames.length,
    );
  });

  it("never carries a stale skip entry", () => {
    for (const table of Object.keys(LWQL_CATALOG_SKIPPED_TABLES)) {
      expect(
        manifestTableNames,
        `skip entry "${table}" (${LWQL_CATALOG_SKIPPED_TABLES[table]}) names no manifest table`,
      ).toContain(table);
    }
  });

  it("the merged LWQL_VIEW_CATALOG carries every derived and hand-written table", () => {
    const mergedSourceTables = new Set(LWQL_VIEW_CATALOG.map((view) => view.sourceTable));
    for (const table of [...handWritten, ...derivedSourceTables]) {
      expect(
        mergedSourceTables.has(table),
        `"${table}" is accounted for but missing from LWQL_VIEW_CATALOG`,
      ).toBe(true);
    }
  });
});
