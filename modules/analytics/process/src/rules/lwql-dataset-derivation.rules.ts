/** Builds {@link LangWatchQLViewDefinition}s from a source table's generated column manifest. */

import type {
  LangWatchQLColumnUnit,
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  type ColumnsManifest,
  type ColumnsManifestTable,
  columnsManifestTable,
} from "./lwql-columns-manifest.rules.ts";
import { contentFilteredMapSql } from "./lwql-content-gating.rules.ts";
import type { FieldProtection } from "./lwql-field-protection.rules.ts";
import { skipReason } from "./lwql-skipped-tables.rules.ts";

/** How a derived view deduplicates, mirroring {@link LangWatchQLViewDedup}. */
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
  /** Name the view is exposed under: the `analytics.<name>` a caller writes. */
  readonly name: string;
  /** One line for the schema endpoint. */
  readonly description: string;
  /** Human description of what one row is. */
  readonly grain: string;
  /** The identity of one logical row, when it is narrower than the sort key. */
  readonly grainColumns?: readonly string[];
  /** Columns another view can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /** The column a caller filters to prune partitions. */
  readonly timeColumn: string;
  /** How far behind the write path the view can be. */
  readonly freshness: string;
  /** Permissions a caller must hold to reach the view at all. Defaults to none. */
  readonly gates?: readonly FieldProtection[];
  readonly dedup: DerivedDatasetDedup;
  /** Per-column gates, keyed by the *exposed* column name. */
  readonly columnGates?: Readonly<Record<string, readonly FieldProtection[]>>;
  /** Per-column unit, keyed by the exposed column name. */
  readonly columnUnits?: Readonly<Record<string, LangWatchQLColumnUnit>>;
  /** Renames: `{ exposedName: sourceColumn }`. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Source columns not to expose, each mapped to the reason it is omitted. */
  readonly skipColumns?: Readonly<Record<string, string>>;
  /** Per-column description overrides, keyed by the exposed column name. */
  readonly descriptions?: Readonly<Record<string, string>>;
  /** The source's tenant column, when it is not the default `TenantId`. */
  readonly tenantColumn?: string;
  /** The column manifest to read column names, types and comments from. */
  readonly manifest: ColumnsManifest;
}

/** One column a view exposes, and the source column it reads. */
interface ExposedColumn {
  readonly exposedName: string;
  readonly sourceColumn: string;
  readonly type: string;
  readonly comment: string;
}

/** Splits a sorting key on its top-level commas. Cannot read parenthesised keys. */
function parseSortingKey(sortingKey: string): string[] {
  return sortTopLevel(sortingKey);
}

/** Splits on top-level commas, respecting parentheses (nested type args). */
function sortTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** A `Map(...)` column, whatever its key/value types. */
function isMapType(type: string): boolean {
  return type.startsWith("Map(");
}

/** The type a filtered map is exposed as. */
function filteredMapType(type: string): string {
  return type.replace(/LowCardinality\(String\)/g, "String");
}

/** How an aggregate-function state column is finalised for reading. */
interface AggregateStateSpec {
  /** The combinator applied to the state column, e.g. */
  readonly combinator: string;
  /** The plain type the finalised value has. */
  readonly finalized: string;
  /** A `SimpleAggregateFunction` — combined with its plain function rather than a `-Merge`. */
  readonly simple?: boolean;
}

/**
 * The finalised type of `sum` over `T`. ClickHouse widens a `Decimal(P, S)` sum
 * to the 128-bit `Decimal(38, S)` to leave room against overflow; every other
 * numeric type sums back to itself.
 */
function summedType(valueType: string): string {
  const decimal = /^Decimal\(\s*\d+\s*,\s*(\d+)\s*\)$/.exec(valueType);
  return decimal ? `Decimal(38, ${decimal[1]})` : valueType;
}

/** Aggregate function names whose merged value keeps its source value type. */
const VALUE_PRESERVING_AGGREGATES = new Set(["max", "min", "any", "anyLast", "argMax", "argMin"]);
/** Aggregate function names whose merged value is always a plain `UInt64`. */
const COUNT_LIKE_AGGREGATES = new Set([
  "count",
  "uniq",
  "uniqExact",
  "uniqHLL12",
  "uniqCombined",
  "uniqTheta",
]);
/** Aggregate function names whose merged value is always a plain `Float64`. */
const FLOAT_AGGREGATES = new Set(["avg", "quantile"]);
/** Aggregate function names whose merged value is always `Array(Float64)`. */
const ARRAY_FLOAT_AGGREGATES = new Set(["quantiles", "quantilesExact", "quantilesTDigest"]);

/**
 * One `AggregateFunction(name(params)?, valueType, ...)` type, parsed into its
 * function name, its parenthesised parameters (if any), and its value type —
 * or `null` when `type` is not an `AggregateFunction(...)` at all.
 */
function parseAggregateFunctionType(
  type: string,
): { name: string; params: string; valueType?: string } | null {
  if (!type.startsWith("AggregateFunction(") || !type.endsWith(")")) return null;
  const inner = type.slice("AggregateFunction(".length, -1);
  const args = sortTopLevel(inner);
  const func = args[0];
  if (!func) return null;
  const funcName = /^([A-Za-z0-9_]+)(\(.*\))?$/.exec(func);
  if (!funcName) return null;
  return { name: funcName[1]!, params: funcName[2] ?? "", valueType: args[1] };
}

/**
 * The finalised type an `AggregateFunction`'s `-Merge` combinator reads back,
 * by function name — or `null` for a func {@link aggregateStateSpec} does not
 * know how to finalise.
 */
function mergedFinalizedType(name: string, valueType: string | undefined): string | null {
  if (name === "sum") return valueType ? summedType(valueType) : null;
  if (VALUE_PRESERVING_AGGREGATES.has(name)) return valueType ?? null;
  if (COUNT_LIKE_AGGREGATES.has(name)) return "UInt64";
  if (FLOAT_AGGREGATES.has(name)) return "Float64";
  if (ARRAY_FLOAT_AGGREGATES.has(name)) return "Array(Float64)";
  return null;
}

/**
 * How a source column's aggregate-function state is read back, or `null` when the column is not an
 * aggregate state at all.
 */
function aggregateStateSpec(type: string): AggregateStateSpec | null {
  const simple = /^SimpleAggregateFunction\(\s*([A-Za-z0-9_]+)\s*,\s*(.+)\)$/.exec(type);
  if (simple) {
    return {
      combinator: simple[1]!,
      finalized: simple[2]!.trim(),
      simple: true,
    };
  }
  const parsed = parseAggregateFunctionType(type);
  if (!parsed) return null;
  const finalized = mergedFinalizedType(parsed.name, parsed.valueType);
  if (!finalized) return null;
  return {
    combinator: `${parsed.name}Merge${parsed.params}`,
    finalized,
  };
}

/** A column's exposed shape, derived from its source type. */
interface ProjectedColumn {
  readonly type: string;
  readonly expression?: LangWatchQLViewColumn["expression"];
  readonly aggregate?: boolean;
}

/**
 * How one source column is projected: an aggregate state is finalised with its combinator, a map is
 * content-filtered like `spans.SpanAttributes`, and every other column passes straight through.
 */
function projectColumn({
  sourceColumn,
  type,
  aggregating,
  tableName,
}: {
  sourceColumn: string;
  type: string;
  aggregating: boolean;
  tableName: string;
}): ProjectedColumn {
  const state = aggregateStateSpec(type);
  if (state) {
    if (!aggregating) {
      throw new Error(
        `lwql view over "${tableName}": column "${sourceColumn}" is an ` +
          `aggregate-function state (${type}) but the view is not marked ` +
          `aggregating, so its state cannot be finalised`,
      );
    }
    const finalized = filteredMapType(state.finalized);
    const value = (source: (name: string) => string): string => {
      const combined = `${state.combinator}(${source(sourceColumn)})`;
      // A SimpleAggregateFunction's plain function reports its own state type in
      // system.columns, so cast to the plain type it holds. `-Merge` combinators
      // already return the finalised type, so they need no cast.
      return state.simple ? `CAST(${combined} AS ${finalized})` : combined;
    };
    if (isMapType(finalized)) {
      return {
        type: finalized,
        aggregate: true,
        expression: (source) => contentFilteredMapSql(value(source)),
      };
    }
    return { type: finalized, aggregate: true, expression: value };
  }
  if (isMapType(type)) {
    return {
      type: filteredMapType(type),
      expression: (source) => contentFilteredMapSql(source(sourceColumn)),
    };
  }
  return { type };
}

/**
 * The columns a view exposes: every source column not skipped or aliased away, under its own name,
 * then the renames.
 */
function exposedColumns({
  manifestTable,
  aliases,
  skipColumns,
}: {
  manifestTable: ColumnsManifestTable;
  aliases: Readonly<Record<string, string>>;
  skipColumns: Readonly<Record<string, string>>;
}): ExposedColumn[] {
  const columnByName = new Map(manifestTable.columns.map((column) => [column.name, column]));

  for (const skipped of Object.keys(skipColumns)) {
    if (!columnByName.has(skipped)) {
      throw new Error(
        `lwql view over "${manifestTable.name}": skipColumns names ` +
          `"${skipped}", which is not a column of the table`,
      );
    }
  }

  const aliasedSources = new Set(Object.values(aliases));
  const skipped = new Set([...Object.keys(skipColumns), ...aliasedSources]);

  const passThrough: ExposedColumn[] = manifestTable.columns
    .filter((column) => !skipped.has(column.name))
    .map((column) => ({
      exposedName: column.name,
      sourceColumn: column.name,
      type: column.type,
      comment: column.comment,
    }));

  const renamed: ExposedColumn[] = Object.entries(aliases).map(([exposedName, sourceColumn]) => {
    const column = columnByName.get(sourceColumn);
    if (!column) {
      throw new Error(
        `lwql view over "${manifestTable.name}": alias "${exposedName}" ` +
          `reads "${sourceColumn}", which is not a column of the table`,
      );
    }
    return {
      exposedName,
      sourceColumn,
      type: column.type,
      comment: column.comment,
    };
  });

  return [...passThrough, ...renamed];
}

/**
 * One exposed column's final shape: its type, description, gates and — for an
 * aggregate state or a content map — the `expression` {@link projectColumn}
 * derived for it.
 */
function buildViewColumn({
  column,
  columnGates,
  columnUnits,
  descriptions,
  aggregating,
  tableName,
}: {
  column: ExposedColumn;
  columnGates: Readonly<Record<string, readonly FieldProtection[]>>;
  columnUnits: Readonly<Record<string, LangWatchQLColumnUnit>>;
  descriptions: Readonly<Record<string, string>>;
  aggregating: boolean;
  tableName: string;
}): LangWatchQLViewColumn {
  const unit = columnUnits[column.exposedName];
  const projected = projectColumn({
    sourceColumn: column.sourceColumn,
    type: column.type,
    aggregating,
    tableName,
  });
  return {
    name: column.exposedName,
    type: projected.type,
    description: descriptions[column.exposedName] ?? (column.comment || column.exposedName),
    gates: columnGates[column.exposedName] ?? [],
    sourceColumns: [column.sourceColumn],
    ...(projected.expression ? { expression: projected.expression } : {}),
    ...(projected.aggregate ? { aggregate: true } : {}),
    ...(unit ? { unit } : {}),
  };
}

/** Refuses every per-column annotation map that names a column not exposed. */
function assertOverridesAreExposed({
  name,
  columnGates,
  columnUnits,
  descriptions,
  exposedNames,
}: {
  name: string;
  columnGates: Readonly<Record<string, unknown>>;
  columnUnits: Readonly<Record<string, unknown>>;
  descriptions: Readonly<Record<string, unknown>>;
  exposedNames: ReadonlySet<string>;
}): void {
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
}

/** The `dedup` block of a {@link LangWatchQLViewDefinition}, from its input. */
function buildDedup(
  dedup: DerivedDatasetDedup,
  manifestTable: ColumnsManifestTable,
): LangWatchQLViewDefinition["dedup"] {
  return {
    keyColumns: dedup.keyColumns ?? parseSortingKey(manifestTable.sortingKey),
    ...(dedup.strategy ? { strategy: dedup.strategy } : {}),
    ...(dedup.versionColumn ? { versionColumn: dedup.versionColumn } : {}),
    ...(dedup.aggregating ? { aggregating: dedup.aggregating } : {}),
  };
}

/** Derives a full {@link LangWatchQLViewDefinition} from one manifest table. */
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
    skipColumns = {},
    descriptions = {},
    tenantColumn,
    manifest,
  } = input;

  const manifestTable = columnsManifestTable(manifest, table);
  const exposed = exposedColumns({ manifestTable, aliases, skipColumns });

  const columns: LangWatchQLViewColumn[] = exposed.map((column) =>
    buildViewColumn({
      column,
      columnGates,
      columnUnits,
      descriptions,
      aggregating: dedup.aggregating === true,
      tableName: manifestTable.name,
    }),
  );

  const exposedNames = new Set(columns.map((column) => column.name));
  assertOverridesAreExposed({
    name,
    columnGates,
    columnUnits,
    descriptions,
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
    dedup: buildDedup(dedup, manifestTable),
    columns,
    ...(tenantColumn ? { tenantColumn } : {}),
  };
}

// ---------------------------------------------------------------------------
// Opt-out catalog
// ---------------------------------------------------------------------------

/** The default the derived catalog uses when a table declares no override. */
const DEFAULT_TENANT_COLUMN = "TenantId";

/** Matches existing hand-written views' freshness. */
const DEFAULT_FRESHNESS = "seconds behind ingestion";

/** Column-name suffixes that mark an identifier/label, never free-text content. */
const NON_CONTENT_NAME =
  /(Id|Ids|Hash|Key|Name|Type|Status|Kind|Version|Uri|Url|Slug|Code|Model|Label|Labels|Unit)$/;
const NON_CONTENT_SNAKE =
  /(?:^|_)(id|ids|hash|key|name|type|status|kind|version|uri|url|sha256|slug|code|model|label|labels|unit)$/i;

/** Whether a column name reads as an identifier or label rather than content. */
function isIdentifierName(name: string): boolean {
  return NON_CONTENT_NAME.test(name) || NON_CONTENT_SNAKE.test(name);
}

/** Column names whose values are money — gated `costs` whatever their type. */
const COST_NAME = /cost|spend|usd|price/i;

/** Whether a column's ClickHouse type can carry free-text customer content. */
function isContentType(type: string): boolean {
  if (type.includes("LowCardinality")) return false;
  // A `Nullable(...)` wrapper is about presence, not kind: `Nullable(String)`
  // carries content exactly as `String` does, so classify on the inner type.
  const inner =
    type.startsWith("Nullable(") && type.endsWith(")") ? type.slice("Nullable(".length, -1) : type;
  if (inner === "String") return true;
  if (inner.includes("JSON")) return true;
  if (inner === "Array(String)") return true;
  return /^Map\(.*,\s*String\)$/.test(inner);
}

/** The gates the default classifier assigns a column, before any override: */
export function defaultColumnGates({
  name,
  type,
}: {
  name: string;
  type: string;
}): readonly FieldProtection[] {
  if (COST_NAME.test(name)) return ["costs"];
  // A map is never content-gated: it is content-*filtered* instead (every
  // captured-content key removed, mirroring `spans.SpanAttributes`), so the
  // whole column stays readable while its content keys do not.
  if (isMapType(type)) return [];
  if (isContentType(type) && !isIdentifierName(name)) return ["output"];
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
  /** Source columns not to expose, each mapped to the reason it is omitted. */
  readonly skipColumns: Readonly<Record<string, string>>;
  readonly descriptions: Readonly<Record<string, string>>;
  readonly tenantColumn: string;
}

/** The caller-facing name a view gets by default. */
export function defaultDatasetName(table: string): string {
  return table.startsWith("stored_") ? table.slice("stored_".length) : table;
}

/**
 * The partition-pruning column a table gets by default: the first
 * `DateTime`/`DateTime64` column in the sorting key, else the first such column
 * anywhere, else the first sorting-key column, else the first column.
 */
function defaultTimeColumn(manifestTable: ColumnsManifestTable): string {
  const typeByName = new Map(manifestTable.columns.map((column) => [column.name, column.type]));
  const isDateTime = (type: string | undefined): boolean => type?.startsWith("DateTime") ?? false;
  const sortKey = parseSortingKey(manifestTable.sortingKey);

  const inSortKey = sortKey.find((column) => isDateTime(typeByName.get(column)));
  if (inSortKey) return inSortKey;

  const anyDateTime = manifestTable.columns.find((column) => isDateTime(column.type));
  if (anyDateTime) return anyDateTime.name;

  return sortKey[0] ?? manifestTable.columns[0]?.name ?? "";
}

/**
 * The join keys a table gets by default: its `*Id` columns that also appear on
 * another catalogued table, so a join key is one that can actually match
 * another view.
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
 * a join key that can match another view.
 */
function columnsSharedAcrossTables(tables: readonly ColumnsManifestTable[]): Set<string> {
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
 * A derived table's dedup, with the override merged onto a computed default rather than replacing
 * it outright.
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
    ...(!aggregating && narrowerThanKey ? { strategy: "in-tuple" as const } : {}),
    ...override,
  };
}

/** The default column gates for every exposed column of one derived table. */
function computeDefaultColumnGates(
  exposed: readonly ExposedColumn[],
): Record<string, readonly FieldProtection[]> {
  const computed: Record<string, readonly FieldProtection[]> = {};
  for (const column of exposed) {
    const gates = defaultColumnGates({
      name: column.exposedName,
      type: column.type,
    });
    if (gates.length > 0) computed[column.exposedName] = gates;
  }
  return computed;
}

/**
 * A lookup from a source column's physical name to its exposed name, so the grain and sort key can
 * be spoken in the caller's vocabulary.
 */
function exposedNameLookup(
  aliases: Readonly<Record<string, string>>,
): (physical: string) => string {
  const reverseAlias: Record<string, string> = {};
  for (const [exposed, physical] of Object.entries(aliases)) {
    reverseAlias[physical] = exposed;
  }
  return (physical: string): string => reverseAlias[physical] ?? physical;
}

/** The grain a derived table publishes. */
function computeGrainColumns({
  override,
  aggregating,
  exposedSortKey,
  sortKey,
  tenantColumn,
  exposedOf,
}: {
  override?: readonly string[];
  aggregating: boolean;
  exposedSortKey: readonly string[];
  sortKey: readonly string[];
  tenantColumn: string;
  exposedOf: (physical: string) => string;
}): readonly string[] {
  if (override) return override;
  if (aggregating) return exposedSortKey;
  return sortKey.filter((column) => column !== tenantColumn).map(exposedOf);
}

/** The join keys a derived table advertises. */
function computeJoinKeys({
  aggregating,
  grainColumns,
  override,
  manifestTable,
  sharedColumns,
}: {
  aggregating: boolean;
  grainColumns: readonly string[];
  override?: readonly string[];
  manifestTable: ColumnsManifestTable;
  sharedColumns: ReadonlySet<string>;
}): readonly string[] {
  if (aggregating) return grainColumns;
  return [
    DEFAULT_TENANT_COLUMN,
    ...(override ?? defaultJoinKeys({ manifestTable, sharedColumns })),
  ].filter((key, index, all) => all.indexOf(key) === index);
}

/** The per-table shape {@link deriveDataset} computes before building the input. */
interface DerivedDatasetShape {
  readonly aliases: Readonly<Record<string, string>>;
  readonly skipColumns: Readonly<Record<string, string>>;
  readonly tenantColumn: string;
  readonly columnGates: Record<string, readonly FieldProtection[]>;
  readonly exposedSortKey: readonly string[];
  readonly grainColumns: readonly string[];
  readonly timeColumn: string;
  readonly name: string;
  readonly joinKeys: readonly string[];
}

/**
 * Every value {@link deriveDataset} must compute before it can build the
 * {@link DefineDatasetFromTableInput} — split out so each function stays under
 * the complexity a single derivation step needs.
 */
function deriveDatasetShape({
  manifestTable,
  override,
  sharedColumns,
}: {
  manifestTable: ColumnsManifestTable;
  override: Partial<DatasetOverride>;
  sharedColumns: ReadonlySet<string>;
}): DerivedDatasetShape {
  const aliases = override.aliases ?? {};
  const skipColumns = override.skipColumns ?? {};
  const tenantColumn = override.tenantColumn ?? DEFAULT_TENANT_COLUMN;

  const exposed = exposedColumns({ manifestTable, aliases, skipColumns });
  const columnGates = {
    ...computeDefaultColumnGates(exposed),
    ...override.columnGates,
  };

  const sortKey = parseSortingKey(manifestTable.sortingKey);
  const exposedOf = exposedNameLookup(aliases);
  const exposedSortKey = sortKey.map(exposedOf);
  const aggregating = override.dedup?.aggregating === true;
  const grainColumns = computeGrainColumns({
    override: override.grainColumns,
    aggregating,
    exposedSortKey,
    sortKey,
    tenantColumn,
    exposedOf,
  });
  const timeColumn = override.timeColumn ?? defaultTimeColumn(manifestTable);
  const name = override.name ?? defaultDatasetName(manifestTable.name);
  const joinKeys = computeJoinKeys({
    aggregating,
    grainColumns,
    override: override.joinKeys,
    manifestTable,
    sharedColumns,
  });

  return {
    aliases,
    skipColumns,
    tenantColumn,
    columnGates,
    exposedSortKey,
    grainColumns,
    timeColumn,
    name,
    joinKeys,
  };
}

/** Builds the {@link DefineDatasetFromTableInput} from a table's derived shape. */
function buildDatasetInput({
  manifestTable,
  override,
  shape,
  manifest,
}: {
  manifestTable: ColumnsManifestTable;
  override: Partial<DatasetOverride>;
  shape: DerivedDatasetShape;
  manifest: ColumnsManifest;
}): DefineDatasetFromTableInput {
  const { aliases, skipColumns, tenantColumn, columnGates, grainColumns } = shape;
  return {
    table: manifestTable.name,
    name: shape.name,
    description:
      override.description ??
      `Rows of the ${manifestTable.name} table, one per (${grainColumns.join(", ")}).`,
    grain: override.grain ?? `one row per (${grainColumns.join(", ")}), latest version only`,
    grainColumns,
    joinKeys: shape.joinKeys,
    timeColumn: shape.timeColumn,
    freshness: override.freshness ?? DEFAULT_FRESHNESS,
    ...(override.gates ? { gates: override.gates } : {}),
    dedup: defaultDedup({
      sortKey: shape.exposedSortKey,
      grainColumns,
      override: override.dedup,
    }),
    columnGates,
    ...(override.columnUnits ? { columnUnits: override.columnUnits } : {}),
    aliases,
    skipColumns,
    ...(override.descriptions ? { descriptions: override.descriptions } : {}),
    ...(tenantColumn === DEFAULT_TENANT_COLUMN ? {} : { tenantColumn }),
    manifest,
  };
}

/** Derives one manifest table's view definition, applying its override. */
function deriveDataset({
  manifestTable,
  override,
  sharedColumns,
  manifest,
}: {
  manifestTable: ColumnsManifestTable;
  override: Partial<DatasetOverride>;
  sharedColumns: ReadonlySet<string>;
  manifest: ColumnsManifest;
}): LangWatchQLViewDefinition {
  const shape = deriveDatasetShape({ manifestTable, override, sharedColumns });
  return defineDatasetFromTable(buildDatasetInput({ manifestTable, override, shape, manifest }));
}

/** Every manifest table that is neither hand-written nor skipped, as a derived view definition. */
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
    (table) => !handWrittenSet.has(table.name) && skipReason(table.name, skip) === undefined,
  );
  const sharedColumns = columnsSharedAcrossTables(candidates);

  return candidates.map((manifestTable) =>
    deriveDataset({
      manifestTable,
      override: overrides[manifestTable.name] ?? {},
      sharedColumns,
      manifest,
    }),
  );
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
        `lwql view "${name}": ${kind} names "${key}", which is not an ` +
          `exposed column; it would annotate nothing`,
      );
    }
  }
}
