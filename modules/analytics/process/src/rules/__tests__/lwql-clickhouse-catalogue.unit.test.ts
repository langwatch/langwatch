/**
 * The ClickHouse half of the LWQL catalogue exposes exactly what the derivation exposed before it:
 * every view's names, source columns and gates are pinned in the fixture below.
 * @see specs/lwql/catalogue-grants.feature
 */

import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns, type LwqlCatalogue } from "../lwql-catalogue.rules.ts";
import { LWQL_POSTGRES_CATALOG } from "../lwql-postgres-view-catalog.rules.ts";
import { LWQL_CLICKHOUSE_CATALOGUE, LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const postgres = new Set(LWQL_POSTGRES_CATALOG.map((view) => view.name));
const clickhouse = LWQL_VIEW_CATALOG.filter((view) => !postgres.has(view.name));
const catalogue: LwqlCatalogue = LWQL_CLICKHOUSE_CATALOGUE;

/** One line per column: `Name <- source[, source] (+ joined) [gates]`. */
function exposure(): Record<string, string[]> {
  return Object.fromEntries(
    clickhouse.map((view) => [
      `${view.name} <- ${view.sourceTable}${view.gates.length ? ` [${view.gates.join(",")}]` : ""}`,
      view.columns.map((column) => {
        const joined = column.joinedSourceColumns?.length
          ? ` + ${column.joinedSourceColumns.join(",")}`
          : "";
        const gates = column.gates.length ? ` [${column.gates.join(",")}]` : "";
        return `${column.name} <- ${column.sourceColumns.join(", ")}${joined}${gates}`;
      }),
    ]),
  );
}

describe("given the ClickHouse views", () => {
  it("expose the pinned names, sources and gates", async () => {
    await expect(`${JSON.stringify(exposure(), null, 2)}\n`).toMatchFileSnapshot(
      "./fixtures/lwql-clickhouse-exposure.snapshot.json",
    );
  });

  it("have one catalogue table each, over the same source", () => {
    expect(Object.keys(catalogue).toSorted()).toEqual(clickhouse.map((v) => v.name).toSorted());
    for (const view of clickhouse) {
      expect(catalogue[view.name]?.sourceTable, view.name).toBe(view.sourceTable);
    }
  });

  it("expose exactly the catalogue's columns, each read from its declared source", () => {
    for (const view of clickhouse) {
      const table = catalogue[view.name];
      if (!table) throw new Error(`no catalogue table for ${view.name}`);
      const declared = exposedCatalogueColumns({ table }).map((c) => `${c.name} <- ${c.source}`);
      // A column only the join feeds is declared through the join's primary key.
      const joinKey = view.join?.onSourceColumns?.primary?.at(-1);
      const built = view.columns.map((c) => `${c.name} <- ${c.sourceColumns[0] ?? joinKey}`);
      expect(declared.toSorted(), view.name).toEqual(built.toSorted());
    }
  });

  it("need analytics:view on every table, the door every statement passes", () => {
    for (const [name, table] of Object.entries(catalogue)) {
      expect("allOf" in table.access && table.access.allOf, name).toContain("analytics:view");
    }
  });
});
