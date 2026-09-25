/**
 * The ClickHouse column manifest the derived-view builder reads.
 *
 * A view built by {@link ./defineDatasetFromTable} does not restate its
 * source table's column list — it takes the columns, their exact ClickHouse
 * types and their comments from here, so the published schema cannot drift from
 * what the table actually is. The manifest is *generated*, never hand-edited:
 * `scripts/generate-lwql-columns-manifest.ts` dumps `system.columns` and
 * `system.tables` after the shipped migrations have been replayed into a
 * throwaway ClickHouse, and writes {@link columnsManifest.generated.json}.
 *
 * The parity integration test asserts the committed JSON equals a fresh dump,
 * so a migration that adds, drops or retypes a column fails the test until the
 * manifest is regenerated — the manifest cannot silently describe a schema the
 * database no longer has.
 *
 * @see ./defineDatasetFromTable.ts — the builder that reads it
 * @see ../../../../scripts/generate-lwql-columns-manifest.ts — the generator
 * @see ./__tests__/columnsManifestParity.integration.test.ts — the drift guard
 */

import type { ClickHouseClient } from "@clickhouse/client";

import manifestJson from "./columnsManifest.generated.json";

/** One column of a source table, exactly as `system.columns` reports it. */
export interface ColumnsManifestColumn {
  /** Column name. */
  readonly name: string;
  /** ClickHouse type, verbatim from `system.columns.type`. */
  readonly type: string;
  /** The column's `COMMENT`, or the empty string when it has none. */
  readonly comment: string;
}

/** One table of the manifest, with the facts a view def is built from. */
export interface ColumnsManifestTable {
  /** Table name within the database. */
  readonly name: string;
  /** Engine name from `system.tables.engine` (short form, e.g. `ReplacingMergeTree`). */
  readonly engine: string;
  /** `system.tables.sorting_key`, the engine's `ORDER BY`, comma-separated. */
  readonly sortingKey: string;
  /** Columns in `system.columns.position` order — the table's DDL order. */
  readonly columns: readonly ColumnsManifestColumn[];
}

/** Every table in the migrated database, ordered by name. */
export interface ColumnsManifest {
  readonly tables: readonly ColumnsManifestTable[];
}

/** The committed manifest, loaded from the generated JSON. */
export const LWQL_COLUMNS_MANIFEST = manifestJson as ColumnsManifest;

/**
 * The manifest entry for one table, or a throw naming how to fix its absence.
 *
 * A view that names a table the manifest does not carry is a catalog bug the
 * builder catches at construction rather than a view that renders against a
 * column list from nowhere.
 */
export function columnsManifestTable(
  manifest: ColumnsManifest,
  table: string,
): ColumnsManifestTable {
  const found = manifest.tables.find((entry) => entry.name === table);
  if (!found) {
    throw new Error(
      `lwql columns manifest: table "${table}" is not in the manifest; ` +
        `regenerate it with \`pnpm generate:lwql-columns-manifest\``,
    );
  }
  return found;
}

/**
 * Builds the manifest from a live ClickHouse database.
 *
 * The one place the manifest's shape is produced, so the generator and the
 * parity test agree by construction rather than by two transcriptions that have
 * to be kept the same. Ordering is fixed — tables by name, columns by their
 * `position` — so a regeneration that changed nothing produces a byte-identical
 * file and the parity test compares like for like.
 *
 * Materialized-view inner tables (`.inner*`) are excluded: their names carry a
 * random UUID, which would make the manifest non-deterministic.
 */
export async function buildColumnsManifestFromDatabase({
  client,
  database,
}: {
  client: ClickHouseClient;
  database: string;
}): Promise<ColumnsManifest> {
  const tableRows = await client
    .query({
      query:
        "SELECT name, engine, sorting_key AS sortingKey FROM system.tables " +
        "WHERE database = {database:String} AND name NOT LIKE '.%' ORDER BY name",
      query_params: { database },
      format: "JSONEachRow",
    })
    .then((result) =>
      result.json<{ name: string; engine: string; sortingKey: string }>(),
    );

  const columnRows = await client
    .query({
      query:
        "SELECT table, name, type, comment FROM system.columns " +
        "WHERE database = {database:String} AND table NOT LIKE '.%' " +
        "ORDER BY table, position",
      query_params: { database },
      format: "JSONEachRow",
    })
    .then((result) =>
      result.json<{
        table: string;
        name: string;
        type: string;
        comment: string;
      }>(),
    );

  const columnsByTable = new Map<string, ColumnsManifestColumn[]>();
  for (const row of columnRows) {
    const list = columnsByTable.get(row.table) ?? [];
    list.push({ name: row.name, type: row.type, comment: row.comment });
    columnsByTable.set(row.table, list);
  }

  return {
    tables: tableRows.map((table) => ({
      name: table.name,
      engine: table.engine,
      sortingKey: table.sortingKey,
      columns: columnsByTable.get(table.name) ?? [],
    })),
  };
}
