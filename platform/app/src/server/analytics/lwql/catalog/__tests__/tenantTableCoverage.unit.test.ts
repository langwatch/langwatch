/**
 * Every table in the committed ClickHouse columns manifest is accounted for by
 * the include list.
 *
 * The catalog's opt-in design ({@link ../defineDatasetFromTable#deriveDefaultCatalog})
 * only holds if the accounting is exhaustive and non-overlapping: a table is
 * exactly one of hand-written (its physical table backs an entry in
 * {@link LWQL_VIEW_CATALOG} that {@link LWQL_DERIVED_CATALOG} did not produce),
 * included (named on {@link LWQL_CLICKHOUSE_INCLUDED_TABLES}, so it is derived —
 * imported here as {@link LWQL_DERIVED_CATALOG} rather than re-derived, so the
 * shipped catalog and this guard compute the same answer), or unlisted
 * (everything else, simply not queryable). This guards that invariant directly
 * against the committed manifest, and pins the current split with literal counts
 * so a table quietly moving between buckets — or the include list drifting from
 * the manifest — shows up as a failing assertion, not a silent change in
 * `derived.length`.
 */

import { describe, expect, it } from "vitest";

import { lwqlSourceColumnGrants } from "../../provisioning/catalogStatements";
import {
  type ColumnsManifest,
  LWQL_COLUMNS_MANIFEST,
} from "../columnsManifest";
import { deriveDefaultCatalog } from "../defineDatasetFromTable";
import {
  LWQL_DERIVED_CATALOG,
  LWQL_HAND_WRITTEN_SOURCE_TABLES,
} from "../derivedViews";
import { LWQL_CLICKHOUSE_INCLUDED_TABLES } from "../includedTables";
// `lwqlViews` is imported before `derivedViews` deliberately: both sit in one
// ESM cycle (lwqlViews -> derivedViews -> overrides/coding ->
// provisioning/catalogStatements -> lwqlViews), and whichever of the two this
// file touches first becomes the cycle's entry point. Only entering through
// lwqlViews resolves cleanly — see the comment on
// `LWQL_HAND_WRITTEN_SOURCE_TABLES` in ../derivedViews.ts for why the cycle
// exists at all and why it's safe from that side.
import { LWQL_VIEW_CATALOG } from "../lwqlViews";

const manifestTableNames = LWQL_COLUMNS_MANIFEST.tables.map(
  (table) => table.name,
);

// Widened to a plain string array: manifest table names are dynamic strings,
// not the literal union `LWQL_HAND_WRITTEN_SOURCE_TABLES` carries, and
// `.includes` on a `readonly [...] as const` tuple requires an argument of
// that exact literal union.
const handWritten: readonly string[] = LWQL_HAND_WRITTEN_SOURCE_TABLES;
const included = new Set(LWQL_CLICKHOUSE_INCLUDED_TABLES);
const derived = LWQL_DERIVED_CATALOG;
const derivedSourceTables = new Set(derived.map((view) => view.sourceTable));

const HAND_WRITTEN_TABLE_COUNT = 11;
const INCLUDED_TABLE_COUNT = 29;
const UNLISTED_TABLE_COUNT = 5;

// Two disjoint names so a grant assertion built from this manifest cannot
// pass by accident.
const TWO_TABLE_MANIFEST: ColumnsManifest = {
  tables: [
    {
      name: "alpha_rows",
      engine: "ReplacingMergeTree",
      sortingKey: "TenantId, RowId",
      columns: [
        { name: "TenantId", type: "String", comment: "Project." },
        { name: "RowId", type: "String", comment: "" },
      ],
    },
    {
      name: "omega_rows",
      engine: "ReplacingMergeTree",
      sortingKey: "TenantId, RowId",
      columns: [
        { name: "TenantId", type: "String", comment: "Project." },
        { name: "RowId", type: "String", comment: "" },
      ],
    },
  ],
};

describe("given every table in the committed ClickHouse columns manifest", () => {
  it("is hand-written, included, or unlisted — exactly once", () => {
    for (const table of manifestTableNames) {
      const buckets = [
        handWritten.includes(table),
        included.has(table),
        !handWritten.includes(table) && !included.has(table),
      ].filter(Boolean).length;
      expect(buckets, `"${table}" should land in exactly one bucket`).toBe(1);
      // An included, non-hand-written table backs a derived view.
      expect(derivedSourceTables.has(table)).toBe(
        included.has(table) && !handWritten.includes(table),
      );
    }
  });

  it("derives every include entry exactly once and never a hand-written one", () => {
    for (const table of LWQL_CLICKHOUSE_INCLUDED_TABLES) {
      expect(
        handWritten,
        `${table} must not also be hand-written`,
      ).not.toContain(table);
      const backing = derived.filter((view) => view.sourceTable === table);
      expect(backing.length, `"${table}" should be derived exactly once`).toBe(
        1,
      );
    }
    expect(derived.length).toBe(LWQL_CLICKHOUSE_INCLUDED_TABLES.length);
  });

  it("pins the current split with literal counts, so drift is visible", () => {
    const handWrittenChTables = manifestTableNames.filter((table) =>
      handWritten.includes(table),
    );
    const unlisted = manifestTableNames.filter(
      (table) => !handWritten.includes(table) && !included.has(table),
    );

    expect(handWrittenChTables.length).toBe(HAND_WRITTEN_TABLE_COUNT);
    expect(derived.length).toBe(INCLUDED_TABLE_COUNT);
    expect(unlisted.length).toBe(UNLISTED_TABLE_COUNT);
    expect(handWrittenChTables.length + derived.length + unlisted.length).toBe(
      manifestTableNames.length,
    );
  });

  it("never lists a table the manifest does not carry", () => {
    for (const table of LWQL_CLICKHOUSE_INCLUDED_TABLES) {
      expect(
        manifestTableNames,
        `include entry "${table}" names no manifest table`,
      ).toContain(table);
    }
  });

  it("the merged LWQL_VIEW_CATALOG carries every derived and hand-written table", () => {
    const mergedSourceTables = new Set(
      LWQL_VIEW_CATALOG.map((view) => view.sourceTable),
    );
    for (const table of [...handWritten, ...derivedSourceTables]) {
      expect(
        mergedSourceTables.has(table),
        `"${table}" is accounted for but missing from LWQL_VIEW_CATALOG`,
      ).toBe(true);
    }
  });

  describe("when a table is not on the include list", () => {
    /** @scenario "A table that is not on the include list is not queryable" */
    it("derives no view for it and no grant references it", () => {
      const views = deriveDefaultCatalog({
        manifest: TWO_TABLE_MANIFEST,
        include: ["alpha_rows"],
        handWritten: [],
      });
      const sources = views.map((view) => view.sourceTable);
      expect(sources).toEqual(["alpha_rows"]);
      expect(sources).not.toContain("omega_rows");

      const grants = lwqlSourceColumnGrants({ views });
      expect(Object.keys(grants)).toContain("alpha_rows");
      expect(Object.keys(grants)).not.toContain("omega_rows");
    });
  });

  describe("when the include list names a table that does not exist", () => {
    /** @scenario "An include-list entry whose table no longer exists fails the build" */
    it("fails the build and names the entry", () => {
      let message = "";
      try {
        deriveDefaultCatalog({
          manifest: LWQL_COLUMNS_MANIFEST,
          include: ["no_such_table"],
          handWritten: LWQL_HAND_WRITTEN_SOURCE_TABLES,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("no_such_table");
      expect(message).toContain("names no manifest table");
    });
  });

  describe("when the include list names the same table twice", () => {
    it("fails the build and names the entry", () => {
      let message = "";
      try {
        deriveDefaultCatalog({
          manifest: TWO_TABLE_MANIFEST,
          include: ["alpha_rows", "alpha_rows"],
          handWritten: [],
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("alpha_rows");
      expect(message).toContain("is listed more than once");
    });
  });

  describe("when the include list names a table that is already hand-written", () => {
    it("fails the build and names the entry", () => {
      let message = "";
      try {
        deriveDefaultCatalog({
          manifest: TWO_TABLE_MANIFEST,
          include: ["alpha_rows"],
          handWritten: ["alpha_rows"],
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("alpha_rows");
      expect(message).toContain("already hand-written");
    });
  });
});
