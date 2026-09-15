/**
 * The derived-dataset builder and the opt-out catalog it feeds.
 *
 * Two things under test. {@link defineDatasetFromTable} turns one manifest table
 * into a view definition — the column list and types come from the manifest, the
 * caller supplies the rest — and this checks the mapping: renames, skips, gates,
 * descriptions and the dedup key it defaults from the sorting key.
 * {@link deriveDefaultCatalog} makes the catalog opt-*out*, yielding a dataset
 * for every table that is neither hand-written nor skipped, and this pins its
 * safe-by-default gate classification against the real committed manifest, so a
 * content column that stopped being gated is a red test.
 */

import { describe, expect, it } from "vitest";

import {
  type ColumnsManifest,
  LWQL_COLUMNS_MANIFEST,
} from "../columnsManifest";
import {
  defaultColumnGates,
  defaultDatasetName,
  defineDatasetFromTable,
  deriveDefaultCatalog,
} from "../defineDatasetFromTable";
import { LWQL_VIEW_CATALOG } from "../lwqlViews";
import { LWQL_CATALOG_SKIPPED_TABLES, skipReason } from "../skippedTables";

const FAKE_MANIFEST: ColumnsManifest = {
  tables: [
    {
      name: "widgets",
      engine: "ReplacingMergeTree",
      sortingKey: "TenantId, WidgetId",
      columns: [
        { name: "TenantId", type: "String", comment: "Project." },
        { name: "WidgetId", type: "String", comment: "" },
        { name: "Payload", type: "String", comment: "The raw body." },
        { name: "InternalRev", type: "UInt64", comment: "bookkeeping" },
        { name: "LegacyName", type: "String", comment: "old" },
      ],
    },
  ],
};

describe("given a manifest table", () => {
  describe("when defining a dataset over it", () => {
    const def = defineDatasetFromTable({
      table: "widgets",
      name: "widget_rows",
      description: "Widgets.",
      grain: "one row per widget",
      joinKeys: ["TenantId", "WidgetId"],
      timeColumn: "WidgetId",
      freshness: "seconds behind ingestion",
      dedup: { versionColumn: "InternalRev" },
      columnGates: { Body: ["output"] },
      aliases: { Body: "Payload" },
      skipColumns: ["InternalRev", "LegacyName"],
      descriptions: { Body: "The body, renamed." },
      tenantColumn: "project_id",
      manifest: FAKE_MANIFEST,
    });

    it("names the dataset and its source table", () => {
      expect(def.name).toBe("widget_rows");
      expect(def.sourceTable).toBe("widgets");
    });

    it("exposes the pass-through columns and the alias, and no others", () => {
      expect(def.columns.map((column) => column.name)).toEqual([
        "TenantId",
        "WidgetId",
        "Body",
      ]);
    });

    it("takes the alias's type and source column from the manifest", () => {
      const body = def.columns.find((column) => column.name === "Body");
      expect(body).toMatchObject({
        type: "String",
        sourceColumns: ["Payload"],
        gates: ["output"],
        description: "The body, renamed.",
      });
    });

    it("defaults a column description to its comment, then to its name", () => {
      const tenant = def.columns.find((column) => column.name === "TenantId");
      const widget = def.columns.find((column) => column.name === "WidgetId");
      expect(tenant?.description).toBe("Project.");
      expect(widget?.description).toBe("WidgetId");
    });

    it("defaults the dedup key columns to the sorting key", () => {
      expect(def.dedup.keyColumns).toEqual(["TenantId", "WidgetId"]);
      expect(def.dedup.versionColumn).toBe("InternalRev");
    });

    it("passes the tenant-column override through", () => {
      expect(def.tenantColumn).toBe("project_id");
    });
  });

  describe("when the caller names something the table does not have", () => {
    const base = {
      name: "x",
      description: "d",
      grain: "g",
      joinKeys: ["TenantId"],
      timeColumn: "TenantId",
      freshness: "f",
      dedup: {},
      manifest: FAKE_MANIFEST,
    } as const;

    it("refuses an unknown source table", () => {
      expect(() => defineDatasetFromTable({ ...base, table: "nope" })).toThrow(
        /not in the manifest/,
      );
    });

    it("refuses an alias to a column that does not exist", () => {
      expect(() =>
        defineDatasetFromTable({
          ...base,
          table: "widgets",
          aliases: { Body: "NoSuchColumn" },
        }),
      ).toThrow(/not a column of the table/);
    });

    it("refuses a gate keyed on a column that is not exposed", () => {
      expect(() =>
        defineDatasetFromTable({
          ...base,
          table: "widgets",
          columnGates: { NotExposed: ["output"] },
        }),
      ).toThrow(/not an exposed column/);
    });

    it("refuses skipping a column that does not exist", () => {
      expect(() =>
        defineDatasetFromTable({
          ...base,
          table: "widgets",
          skipColumns: ["Ghost"],
        }),
      ).toThrow(/not a column of the table/);
    });
  });
});

describe("given the default gate classifier", () => {
  it("gates a free-text content column output", () => {
    expect(
      defaultColumnGates({ name: "BodyText", type: "Nullable(String)" }),
    ).toEqual(["output"]);
  });

  it("gates a money column costs, whatever its type", () => {
    expect(
      defaultColumnGates({ name: "TargetCost", type: "Nullable(Float64)" }),
    ).toEqual(["costs"]);
  });

  it("leaves an identifier ungated even when it is a string", () => {
    expect(
      defaultColumnGates({ name: "SeriesId", type: "FixedString(64)" }),
    ).toEqual([]);
    expect(defaultColumnGates({ name: "SessionId", type: "String" })).toEqual(
      [],
    );
  });

  it("leaves a low-cardinality label ungated", () => {
    expect(
      defaultColumnGates({ name: "Agent", type: "LowCardinality(String)" }),
    ).toEqual([]);
  });
});

describe("given the opt-out catalog over the committed manifest", () => {
  const handWritten = LWQL_VIEW_CATALOG.map((view) => view.sourceTable);
  const derived = deriveDefaultCatalog({
    manifest: LWQL_COLUMNS_MANIFEST,
    skip: LWQL_CATALOG_SKIPPED_TABLES,
    handWritten,
  });
  const bySource = new Map(derived.map((view) => [view.sourceTable, view]));

  it("yields a definition for every table that is neither hand-written nor skipped", () => {
    const expected = LWQL_COLUMNS_MANIFEST.tables
      .map((table) => table.name)
      .filter(
        (name) =>
          !handWritten.includes(name) &&
          skipReason(name, LWQL_CATALOG_SKIPPED_TABLES) === undefined,
      );
    expect([...bySource.keys()].sort()).toEqual([...expected].sort());
    expect(derived.length).toBeGreaterThan(0);
  });

  it("excludes hand-written and skipped tables", () => {
    for (const source of bySource.keys()) {
      expect(handWritten).not.toContain(source);
      expect(skipReason(source, LWQL_CATALOG_SKIPPED_TABLES)).toBeUndefined();
    }
  });

  it("gives every table a caller-facing name that is not its physical name", () => {
    for (const view of derived) {
      expect(defaultDatasetName(view.sourceTable)).toBe(view.name);
    }
  });

  it.each([
    ["log_records", "BodyText", ["output"]],
    ["experiment_run_items", "TargetCost", ["costs"]],
    ["metric_series", "SeriesId", []],
  ] as const)("classifies %s.%s as %j", (sourceTable, columnName, expectedGates) => {
    const view = bySource.get(sourceTable);
    expect(view, `${sourceTable} not derived`).toBeDefined();
    const column = view?.columns.find((c) => c.name === columnName);
    expect(column, `${sourceTable}.${columnName} not exposed`).toBeDefined();
    expect(column?.gates).toEqual(expectedGates);
  });
});
