/**
 * Builds {@link LangWatchQLViewDefinition}s from a source table's generated
 * column manifest.
 *
 * Two entry points, one construction path:
 *
 *  - {@link defineDatasetFromTable} builds one dataset from one table, reading
 *    the exposed columns and their exact ClickHouse types from
 *    {@link ./columnsManifest} so the published schema cannot drift from what
 *    the table actually is. The caller declares only what the manifest cannot
 *    know — the exposed name, the grain, the join and time columns, which
 *    columns are gated, and any renames.
 *  - {@link deriveDefaultCatalog} makes the catalog opt-*out*: it yields a
 *    dataset for every manifest table that is neither hand-written nor skipped,
 *    with safe defaults (content columns gated `output`, cost columns gated
 *    `costs`) that an override can refine or lift. A new table is therefore
 *    catalogued and content-gated by default, rather than silently omitted.
 *
 * The output is shape-identical to a hand-written entry: the same consumers
 * (schema endpoint, AST validator, provisioning generators) read it without
 * knowing it was derived.
 *
 * @see ./columnsManifest.ts — where the column types come from
 * @see ./skippedTables.ts — what opt-out leaves off, and why
 * @see ./types.ts — the shape this produces
 */

import type { FieldProtection } from "../../../traces/projection/catalog";
import {
  type ColumnsManifest,
  type ColumnsManifestTable,
  columnsManifestTable,
} from "./columnsManifest";
import { skipReason } from "./skippedTables";
import type {
  LangWatchQLColumnUnit,
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "./types";

/** How a derived dataset deduplicates, mirroring {@link LangWatchQLViewDedup}. */
export interface DerivedDatasetDedup {
  /**
   * The source's `ORDER BY`. Defaults to the manifest's sorting key, split on
   * its top-level commas — pass this explicitly when the sorting key contains a
   * function call, which the naive split cannot read.
   */
  readonly keyColumns?: readonly string[];
  readonly strategy?: LangWatchQLViewDefinition["dedup"]["strategy"];
  readonly versionColumn?: string;
  readonly aggregating?: boolean;
}

export interface DefineDatasetFromTableInput {
  /** Physical source table. Must be a table the manifest carries. */
  readonly table: string;
  /** Name the dataset is exposed under: the `analytics.<name>` a caller writes. */
  readonly name: string;
  /** One line for the schema endpoint. */
  readonly description: string;
  /** Human description of what one row is. */
  readonly grain: string;
  /** The identity of one logical row, when it is narrower than the sort key. */
  readonly grainColumns?: readonly string[];
  /** Columns another dataset can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /** The column a caller filters to prune partitions. */
  readonly timeColumn: string;
  /** How far behind the write path the view can be. */
  readonly freshness: string;
  /** Permissions a caller must hold to reach the dataset at all. Defaults to none. */
  readonly gates?: readonly FieldProtection[];
  readonly dedup: DerivedDatasetDedup;
  /**
   * Per-column gates, keyed by the *exposed* column name.
   *
   * A column absent from this map is ungated. A key that names no exposed column
   * is a typo the builder refuses rather than a gate that silently protects
   * nothing.
   */
  readonly columnGates?: Readonly<Record<string, readonly FieldProtection[]>>;
  /** Per-column unit, keyed by the exposed column name. */
  readonly columnUnits?: Readonly<Record<string, LangWatchQLColumnUnit>>;
  /**
   * Renames: `{ exposedName: sourceColumn }`.
   *
   * The exposed column reads `sourceColumn` under the new name, and the source
   * column is not also exposed under its own name. Its type and comment come
   * from the manifest entry for `sourceColumn`.
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Source columns not to expose — bookkeeping the catalog convention omits. */
  readonly skipColumns?: readonly string[];
  /**
   * Per-column description overrides, keyed by the exposed column name.
   *
   * A column with no override takes its description from the manifest comment,
   * falling back to the exposed name when the column has no comment — the schema
   * endpoint requires every column to describe itself.
   */
  readonly descriptions?: Readonly<Record<string, string>>;
  /** The source's tenant column, when it is not the default `TenantId`. */
  readonly tenantColumn?: string;
  /** The column manifest to read column names, types and comments from. */
  readonly manifest: ColumnsManifest;
}

/** One column a dataset exposes, and the source column it reads. */
interface ExposedColumn {
  readonly exposedName: string;
  readonly sourceColumn: string;
  readonly type: string;
  readonly comment: string;
}

/** Splits a sorting key on its top-level commas. Cannot read parenthesised keys. */
function parseSortingKey(sortingKey: string): string[] {
  return sortingKey
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The columns a dataset exposes: every source column not skipped or aliased
 * away, under its own name, then the renames.
 *
 * The one place the exposed set is computed, so the builder and the default-gate
 * classifier see the same columns under the same names.
 */
function exposedColumns({
  manifestTable,
  aliases,
  skipColumns,
}: {
  manifestTable: ColumnsManifestTable;
  aliases: Readonly<Record<string, string>>;
  skipColumns: readonly string[];
}): ExposedColumn[] {
  const columnByName = new Map(
    manifestTable.columns.map((column) => [column.name, column]),
  );

  for (const skipped of skipColumns) {
    if (!columnByName.has(skipped)) {
      throw new Error(
        `lwql dataset over "${manifestTable.name}": skipColumns names ` +
          `"${skipped}", which is not a column of the table`,
      );
    }
  }

  const aliasedSources = new Set(Object.values(aliases));
  const skipped = new Set([...skipColumns, ...aliasedSources]);

  const passThrough: ExposedColumn[] = manifestTable.columns
    .filter((column) => !skipped.has(column.name))
    .map((column) => ({
      exposedName: column.name,
      sourceColumn: column.name,
      type: column.type,
      comment: column.comment,
    }));

  const renamed: ExposedColumn[] = Object.entries(aliases).map(
    ([exposedName, sourceColumn]) => {
      const column = columnByName.get(sourceColumn);
      if (!column) {
        throw new Error(
          `lwql dataset over "${manifestTable.name}": alias "${exposedName}" ` +
            `reads "${sourceColumn}", which is not a column of the table`,
        );
      }
      return {
        exposedName,
        sourceColumn,
        type: column.type,
        comment: column.comment,
      };
    },
  );

  return [...passThrough, ...renamed];
}

/**
 * Derives a full {@link LangWatchQLViewDefinition} from one manifest table.
 *
 * Every exposed column is a straight pass-through of a source column — its type
 * is the manifest's, its `sourceColumns` is the single column it reads.
 * Aliases rename; `skipColumns` drops; `columnGates`, `columnUnits` and
 * `descriptions` annotate. Nothing here builds an `expression` or a `summed`
 * measure: a dataset that needs either is hand-written, because those are the
 * two places a column's meaning can be restated and drift.
 */
export function defineDatasetFromTable(
  input: DefineDatasetFromTableInput,
): LangWatchQLViewDefinition {
  const {
    table,
    name,
    description,
    grain,
    grainColumns,
    joinKeys,
    timeColumn,
    freshness,
    gates = [],
    dedup,
    columnGates = {},
    columnUnits = {},
    aliases = {},
    skipColumns = [],
    descriptions = {},
    tenantColumn,
    manifest,
  } = input;

  const manifestTable = columnsManifestTable(manifest, table);
  const exposed = exposedColumns({ manifestTable, aliases, skipColumns });

  const columns: LangWatchQLViewColumn[] = exposed.map((column) => {
    const unit = columnUnits[column.exposedName];
    return {
      name: column.exposedName,
      type: column.type,
      description:
        descriptions[column.exposedName] ??
        (column.comment || column.exposedName),
      gates: columnGates[column.exposedName] ?? [],
      sourceColumns: [column.sourceColumn],
      ...(unit ? { unit } : {}),
    };
  });

  const exposedNames = new Set(columns.map((column) => column.name));
  assertKeysAreExposed({
    name,
    map: columnGates,
    kind: "columnGates",
    exposedNames,
  });
  assertKeysAreExposed({
    name,
    map: columnUnits,
    kind: "columnUnits",
    exposedNames,
  });
  assertKeysAreExposed({
    name,
    map: descriptions,
    kind: "descriptions",
    exposedNames,
  });

  return {
    name,
    sourceTable: table,
    description,
    gates,
    grain,
    ...(grainColumns ? { grainColumns } : {}),
    joinKeys,
    timeColumn,
    freshness,
    dedup: {
      keyColumns: dedup.keyColumns ?? parseSortingKey(manifestTable.sortingKey),
      ...(dedup.strategy ? { strategy: dedup.strategy } : {}),
      ...(dedup.versionColumn ? { versionColumn: dedup.versionColumn } : {}),
      ...(dedup.aggregating ? { aggregating: dedup.aggregating } : {}),
    },
    columns,
    ...(tenantColumn ? { tenantColumn } : {}),
  };
}

// ---------------------------------------------------------------------------
// Opt-out catalog
// ---------------------------------------------------------------------------

/** The default the derived catalog uses when a table declares no override. */
const DEFAULT_TENANT_COLUMN = "TenantId";

/** Matches existing hand-written datasets' freshness. */
const DEFAULT_FRESHNESS = "seconds behind ingestion";

/** Column-name suffixes that mark an identifier/label, never free-text content. */
const NON_CONTENT_NAME = /(Id|Ids|Hash|Key|Name|Type|Status|Kind|Version)$/;

/** Column names whose values are money — gated `costs` whatever their type. */
const COST_NAME = /cost|spend|usd|price/i;

/**
 * Whether a column's ClickHouse type can carry free-text customer content.
 *
 * `String`, `JSON`, `Array(String)` and `Map(..., String)` can; a
 * `LowCardinality` wrapper cannot (a low-cardinality column is an enum/label,
 * not a body), and neither can a number, a date or a bool.
 */
function isContentType(type: string): boolean {
  if (type.includes("LowCardinality")) return false;
  // A `Nullable(...)` wrapper is about presence, not kind: `Nullable(String)`
  // carries content exactly as `String` does, so classify on the inner type.
  const inner =
    type.startsWith("Nullable(") && type.endsWith(")")
      ? type.slice("Nullable(".length, -1)
      : type;
  if (inner === "String") return true;
  if (inner.includes("JSON")) return true;
  if (inner === "Array(String)") return true;
  return /^Map\(.*,\s*String\)$/.test(inner);
}

/**
 * The gates the default classifier assigns a column, before any override:
 *
 *  - a money column (`/cost|spend|usd|price/i`) → `costs`;
 *  - a free-text content column that is not an identifier/label → `output`;
 *  - everything else → ungated.
 *
 * Safe by default: an unclassified content column is gated rather than exposed,
 * so forgetting to gate one is never how content leaks.
 */
export function defaultColumnGates({
  name,
  type,
}: {
  name: string;
  type: string;
}): readonly FieldProtection[] {
  if (COST_NAME.test(name)) return ["costs"];
  if (isContentType(type) && !NON_CONTENT_NAME.test(name)) return ["output"];
  return [];
}

/** Everything a table's override can set, all optional. */
export interface DatasetOverride {
  readonly name: string;
  readonly description: string;
  readonly grain: string;
  readonly grainColumns: readonly string[];
  readonly joinKeys: readonly string[];
  readonly timeColumn: string;
  readonly freshness: string;
  readonly gates: readonly FieldProtection[];
  readonly dedup: DerivedDatasetDedup;
  /** Per-column gates; set `[]` to opt a column out of its default gate. */
  readonly columnGates: Readonly<Record<string, readonly FieldProtection[]>>;
  readonly columnUnits: Readonly<Record<string, LangWatchQLColumnUnit>>;
  readonly aliases: Readonly<Record<string, string>>;
  readonly skipColumns: readonly string[];
  readonly descriptions: Readonly<Record<string, string>>;
  readonly tenantColumn: string;
}

/**
 * The caller-facing name a table gets by default.
 *
 * It must differ from every physical table name — the collision guard rejects a
 * dataset whose name matches a migration-created object, because the bridge
 * would then `CREATE OR REPLACE VIEW` over a real table. Stripping a `stored_`
 * prefix gives a distinct name for the stored-payload tables; every other table
 * keeps its name here and relies on an override to pick a non-colliding one.
 */
export function defaultDatasetName(table: string): string {
  return table.startsWith("stored_") ? table.slice("stored_".length) : table;
}

/**
 * The partition-pruning column a table gets by default: the first
 * `DateTime`/`DateTime64` column in the sorting key, else the first such column
 * anywhere, else the first sorting-key column, else the first column.
 */
function defaultTimeColumn(manifestTable: ColumnsManifestTable): string {
  const typeByName = new Map(
    manifestTable.columns.map((column) => [column.name, column.type]),
  );
  const isDateTime = (type: string | undefined): boolean =>
    type?.startsWith("DateTime") ?? false;
  const sortKey = parseSortingKey(manifestTable.sortingKey);

  const inSortKey = sortKey.find((column) =>
    isDateTime(typeByName.get(column)),
  );
  if (inSortKey) return inSortKey;

  const anyDateTime = manifestTable.columns.find((column) =>
    isDateTime(column.type),
  );
  if (anyDateTime) return anyDateTime.name;

  return sortKey[0] ?? manifestTable.columns[0]?.name ?? "";
}

/**
 * The join keys a table gets by default: its `*Id` columns that also appear on
 * another catalogued table, so a join key is one that can actually match
 * another dataset.
 */
function defaultJoinKeys({
  manifestTable,
  sharedColumns,
}: {
  manifestTable: ColumnsManifestTable;
  sharedColumns: ReadonlySet<string>;
}): string[] {
  return manifestTable.columns
    .map((column) => column.name)
    .filter((name) => name.endsWith("Id") && sharedColumns.has(name));
}

/**
 * The names that appear on more than one catalogued table — the candidates for
 * a join key that can match another dataset.
 */
function columnsSharedAcrossTables(
  tables: readonly ColumnsManifestTable[],
): Set<string> {
  const seenOnce = new Set<string>();
  const shared = new Set<string>();
  for (const table of tables) {
    for (const column of table.columns) {
      if (seenOnce.has(column.name)) shared.add(column.name);
      else seenOnce.add(column.name);
    }
  }
  return shared;
}

/**
 * A derived table's dedup, with the override merged onto a computed default
 * rather than replacing it outright.
 *
 * The default engine key is the sort key, and the default strategy is
 * `in-tuple` exactly when the published grain is narrower than that key —
 * which it always is once {@link deriveDefaultCatalog} strips the tenant
 * column from the grain — because plain `FINAL` can only merge on the whole
 * engine key, never a subset of it. An override that sets `aggregating: true`
 * turns the narrowing off here: an aggregating source delivers its narrower
 * grain through the `GROUP BY` render instead, and carrying both would be a
 * claim about two mutually exclusive rendering strategies at once. An override
 * that names its own `strategy` or `keyColumns` wins over the computed
 * default, same as every other override field.
 */
function defaultDedup({
  sortKey,
  grainColumns,
  override,
}: {
  sortKey: readonly string[];
  grainColumns: readonly string[];
  override?: DerivedDatasetDedup;
}): DerivedDatasetDedup {
  const aggregating = override?.aggregating === true;
  const narrowerThanKey = grainColumns.length < sortKey.length;
  return {
    keyColumns: sortKey,
    ...(!aggregating && narrowerThanKey
      ? { strategy: "in-tuple" as const }
      : {}),
    ...override,
  };
}

/**
 * Every manifest table that is neither hand-written nor skipped, as a derived
 * dataset definition.
 *
 * The catalog's opt-out half: a table earns a dataset by existing, and stays
 * off only by being in {@link ./skippedTables} with a reason. Defaults are safe
 * — content columns gated `output`, cost columns gated `costs`, a partition
 * column and grain chosen from the schema — and an override refines any of them,
 * including lifting a column's default gate with `columnGates: { Col: [] }`.
 */
export function deriveDefaultCatalog({
  manifest,
  skip,
  handWritten,
  overrides = {},
}: {
  manifest: ColumnsManifest;
  /** The skip map — {@link ./skippedTables#LWQL_CATALOG_SKIPPED_TABLES}. */
  skip: Record<string, string>;
  /** Source tables already carried by hand-written catalog entries. */
  handWritten: readonly string[];
  /** Per-table refinements to the defaults. */
  overrides?: Record<string, Partial<DatasetOverride>>;
}): LangWatchQLViewDefinition[] {
  const handWrittenSet = new Set(handWritten);
  const candidates = manifest.tables.filter(
    (table) =>
      !handWrittenSet.has(table.name) &&
      skipReason(table.name, skip) === undefined,
  );
  const sharedColumns = columnsSharedAcrossTables(candidates);

  return candidates.map((manifestTable) => {
    const override = overrides[manifestTable.name] ?? {};
    const aliases = override.aliases ?? {};
    const skipColumns = override.skipColumns ?? [];
    const tenantColumn = override.tenantColumn ?? DEFAULT_TENANT_COLUMN;

    const exposed = exposedColumns({ manifestTable, aliases, skipColumns });
    const computedGates: Record<string, readonly FieldProtection[]> = {};
    for (const column of exposed) {
      const gates = defaultColumnGates({
        name: column.exposedName,
        type: column.type,
      });
      if (gates.length > 0) computedGates[column.exposedName] = gates;
    }
    const columnGates = { ...computedGates, ...(override.columnGates ?? {}) };

    const sortKey = parseSortingKey(manifestTable.sortingKey);
    const grainColumns =
      override.grainColumns ??
      sortKey.filter((column) => column !== tenantColumn);
    const timeColumn = override.timeColumn ?? defaultTimeColumn(manifestTable);
    const name = override.name ?? defaultDatasetName(manifestTable.name);

    return defineDatasetFromTable({
      table: manifestTable.name,
      name,
      description:
        override.description ??
        `Rows of the ${manifestTable.name} table, one per (${grainColumns.join(", ")}).`,
      grain:
        override.grain ??
        `one row per (${grainColumns.join(", ")}), latest version only`,
      grainColumns,
      joinKeys:
        override.joinKeys ?? defaultJoinKeys({ manifestTable, sharedColumns }),
      timeColumn,
      freshness: override.freshness ?? DEFAULT_FRESHNESS,
      ...(override.gates ? { gates: override.gates } : {}),
      dedup: defaultDedup({ sortKey, grainColumns, override: override.dedup }),
      columnGates,
      ...(override.columnUnits ? { columnUnits: override.columnUnits } : {}),
      aliases,
      skipColumns,
      ...(override.descriptions ? { descriptions: override.descriptions } : {}),
      ...(tenantColumn === DEFAULT_TENANT_COLUMN ? {} : { tenantColumn }),
      manifest,
    });
  });
}

/** Refuses an annotation map keyed on a name no exposed column carries. */
function assertKeysAreExposed({
  name,
  map,
  kind,
  exposedNames,
}: {
  name: string;
  map: Readonly<Record<string, unknown>>;
  kind: string;
  exposedNames: ReadonlySet<string>;
}): void {
  for (const key of Object.keys(map)) {
    if (!exposedNames.has(key)) {
      throw new Error(
        `lwql dataset "${name}": ${kind} names "${key}", which is not an ` +
          `exposed column; it would annotate nothing`,
      );
    }
  }
}
