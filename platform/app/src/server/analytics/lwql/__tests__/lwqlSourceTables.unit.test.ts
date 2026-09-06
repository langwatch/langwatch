/**
 * Which physical tables get a row policy.
 *
 * `lwqlSourceTables` deduplicates the catalog down to the distinct sources
 * that need policing, and the row policy is the tenant boundary — so a source
 * this function drops is a table the restricted identity can read across
 * tenants. The integration suites cannot catch that cheaply: they provision the
 * shipped catalog, which today has no cross-database name collision, so the
 * dedup key can be wrong and every one of them stays green. This file varies
 * the one input that exposes it.
 *
 * @see ../views.ts — the function under test
 * @see ../provisioning.ts — LangWatchQLTable, and the policy built from it
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLViewDefinition } from "../catalog/types";
import type { LangWatchQLNames } from "../provisioning";
import { lwqlSourceTables } from "../views";

const NAMES: LangWatchQLNames = {
  database: "lwql_unit",
  restrictedUser: "lwql_unit_reader",
  settingsProfile: "lwql_unit_profile",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

const SOURCE_DATABASE = "app_unit";

/**
 * Only the fields `lwqlSourceTables` reads. Spelling out the other twelve
 * would say nothing about this behaviour and would have to be re-edited every
 * time the catalog's shape moves.
 */
function view(
  name: string,
  sourceTable: string,
  { isPostgresResident = false }: { isPostgresResident?: boolean } = {},
): LangWatchQLViewDefinition {
  return {
    name,
    sourceTable,
    // Presence of `postgres` is what `isPostgresResident` keys on, and that in
    // turn decides which database the source resolves to.
    ...(isPostgresResident ? { postgres: {} } : {}),
  } as unknown as LangWatchQLViewDefinition;
}

describe("given the LangWatchQL source tables", () => {
  describe("when two views read one table in one database", () => {
    it("collapses them to a single policed source", () => {
      const tables = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        views: [view("traces_a", "traces"), view("traces_b", "traces")],
      });

      // Creating the same policy twice is not idempotent in a way worth
      // relying on, so the dedup itself still has to hold.
      expect(tables).toHaveLength(1);
      expect(tables[0]).toMatchObject({
        table: "traces",
        database: SOURCE_DATABASE,
      });
    });
  });

  describe("when two views read same-named tables in different databases", () => {
    it("keeps both, so neither source loses its row policy", () => {
      const tables = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        views: [
          // A fact table in the application's database...
          view("events_fact", "events"),
          // ...and an unrelated PostgreSQL-engine table of the same name,
          // which resolves to the LangWatchQL database instead.
          view("events_pg", "events", { isPostgresResident: true }),
        ],
      });

      // Keyed on the bare table name these collapse to one entry. The loser
      // gets no row policy, and without a row policy the restricted identity
      // reads that physical table across every tenant.
      expect(
        tables,
        "a name collision across databases must not drop a source",
      ).toHaveLength(2);
      expect(
        tables.map((table) => table.database).sort(),
        "each source keeps the database it actually lives in",
      ).toEqual([NAMES.database, SOURCE_DATABASE].sort());
      expect(new Set(tables.map((table) => table.table))).toEqual(
        new Set(["events"]),
      );
    });
  });
});
