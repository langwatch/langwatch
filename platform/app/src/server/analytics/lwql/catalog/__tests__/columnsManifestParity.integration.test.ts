/**
 * The committed column manifest equals the live ClickHouse schema.
 *
 * `columnsManifest.generated.json` is what the derived-dataset builder reads for
 * every column's exact type, and it is generated — never hand-edited. This proof
 * is what stops it drifting: it runs the shipped migrations into a throwaway
 * ClickHouse through the same harness the other lwql integration suites use,
 * dumps `system.columns` / `system.tables` with the very function the generator
 * calls, and asserts the committed file equals that dump for every table it
 * carries. A migration that adds, drops or retypes a column is therefore a red
 * test here until `pnpm generate:lwql-columns-manifest` is re-run.
 *
 * The harness's fact database carries one table the migrations do not create —
 * the tenant key map its row policy reads — so that one name is excluded from
 * the table-set comparison. Every other table is migration-created and must be
 * in the manifest.
 *
 * @see ../columnsManifest.ts — the manifest and the dump function
 * @see ../../../../../scripts/generate-lwql-columns-manifest.ts — the generator
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../__tests__/lwqlClickHouseHarness";
import {
  buildColumnsManifestFromDatabase,
  type ColumnsManifest,
  LWQL_COLUMNS_MANIFEST,
} from "../columnsManifest";

describe("given the shipped ClickHouse migrations", () => {
  let harness: LangWatchQLClickHouseHarness;
  let live: ColumnsManifest;
  let keyMapTable: string;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "columns_manifest_parity",
      facts: "migrated",
    });
    keyMapTable = harness.names.keyMapTable;
    live = await buildColumnsManifestFromDatabase({
      client: harness.admin,
      database: harness.factDatabase,
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("the manifest lists exactly the migration-created tables, in order", () => {
    const liveMigrationTables = live.tables
      .map((table) => table.name)
      .filter((name) => name !== keyMapTable);
    expect(LWQL_COLUMNS_MANIFEST.tables.map((table) => table.name)).toEqual(
      liveMigrationTables,
    );
  });

  it("every manifest table matches live system.columns exactly", () => {
    const liveByName = new Map(live.tables.map((table) => [table.name, table]));
    for (const table of LWQL_COLUMNS_MANIFEST.tables) {
      const liveTable = liveByName.get(table.name);
      expect(
        liveTable,
        `${table.name} is not in the live schema`,
      ).toBeDefined();
      expect(
        table,
        `${table.name} has drifted from live system.columns — regenerate the manifest`,
      ).toEqual(liveTable);
    }
  });
});
