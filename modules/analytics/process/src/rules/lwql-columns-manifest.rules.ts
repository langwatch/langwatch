/** The ClickHouse column manifest the derived-view builder reads. */

import manifestJson from "./lwql-columns-manifest.generated.json" with { type: "json" };

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
export const LWQL_COLUMNS_MANIFEST: ColumnsManifest = manifestJson;

/** The manifest entry for one table, or a throw naming how to fix its absence. */
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
