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
import { contentFilteredMapSql } from "./contentGating";
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
  /**
   * Source columns not to expose, each mapped to the reason it is omitted.
   *
   * A `Record` rather than a list so "not exposed" is always a recorded
   * decision — the coverage assertion prints the reason, and a skip with no
   * reason cannot be written.
   */
  readonly skipColumns?: Readonly<Record<string, string>>;
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

/**
 * The type a filtered map is exposed as. `mapFilter` returns a plain-keyed map,
 * so a `Map(LowCardinality(String), V)` source becomes `Map(String, V)` — the
 * catalog publishes what the view returns, not what the table stores (mirrors
 * `spans.SpanAttributes` in `lwqlViews.ts`).
 */
function filteredMapType(type: string): string {
  return type.replace(/LowCardinality\(String\)/g, "String");
}

/** How an aggregate-function state column is finalised for reading. */
interface AggregateStateSpec {
  /** The combinator applied to the state column, e.g. `sumMerge`, `argMaxMerge`, or a plain `max`. */
  readonly combinator: string;
  /** The plain type the finalised value has. */
  readonly finalized: string;
  /**
   * A `SimpleAggregateFunction` — combined with its plain function rather than a
   * `-Merge`. Its function preserves the `SimpleAggregateFunction` type in the
   * view's `system.columns` entry (`max` over a `SimpleAggregateFunction(max, T)`
   * reports as that state, not `T`), so the reader wraps it in a `CAST` to the
   * plain type it actually holds.
   */
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

/**
 * How a source column's aggregate-function state is read back, or `null` when
 * the column is not an aggregate state at all.
 *
 * `AggregateFunction(func, ...)` needs the matching `-Merge` combinator to
 * finalise its binary state (`sum` → `sumMerge`, `argMax` → `argMaxMerge`,
 * `count` → `countMerge` typed `UInt64`, `quantiles(...)` → `quantilesMerge(...)`
 * typed `Array(Float64)`); `SimpleAggregateFunction(func, T)` stores the plain
 * value and re-combines under a `GROUP BY` with the plain function itself
 * (`max`), reading back as `T`. A func this does not know maps to `null` — the
 * caller then hand-maps it in an override and pins it with a unit assertion.
 */
function aggregateStateSpec(type: string): AggregateStateSpec | null {
  const simple =
    /^SimpleAggregateFunction\(\s*([A-Za-z0-9_]+)\s*,\s*(.+)\)$/.exec(type);
  if (simple) {
    return {
      combinator: simple[1]!,
      finalized: simple[2]!.trim(),
      simple: true,
    };
  }
  if (!type.startsWith("AggregateFunction(") || !type.endsWith(")"))
    return null;
  const inner = type.slice("AggregateFunction(".length, -1);
  const args = sortTopLevel(inner);
  const func = args[0];
  if (!func) return null;
  const funcName = /^([A-Za-z0-9_]+)(\(.*\))?$/.exec(func);
  if (!funcName) return null;
  const name = funcName[1]!;
  const params = funcName[2] ?? "";
  const mergeCombinator = `${name}Merge${params}`;
  const valueType = args[1];
  switch (name) {
    case "sum":
      return valueType
        ? { combinator: mergeCombinator, finalized: summedType(valueType) }
        : null;
    case "max":
    case "min":
    case "any":
    case "anyLast":
    case "argMax":
    case "argMin":
      return valueType
        ? { combinator: mergeCombinator, finalized: valueType }
        : null;
    case "count":
    case "uniq":
    case "uniqExact":
    case "uniqHLL12":
    case "uniqCombined":
    case "uniqTheta":
      return { combinator: mergeCombinator, finalized: "UInt64" };
    case "avg":
    case "quantile":
      return { combinator: mergeCombinator, finalized: "Float64" };
    case "quantiles":
    case "quantilesExact":
    case "quantilesTDigest":
      return { combinator: mergeCombinator, finalized: "Array(Float64)" };
    default:
      return null;
  }
}

/** A column's exposed shape, derived from its source type. */
interface ProjectedColumn {
  readonly type: string;
  readonly expression?: LangWatchQLViewColumn["expression"];
  readonly aggregate?: boolean;
}

/**
 * How one source column is projected: an aggregate state is finalised with its
 * combinator, a map is content-filtered like `spans.SpanAttributes`, and every
 * other column passes straight through. An aggregate state whose finalised type
 * is itself a map is both — merged, then filtered.
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
        `lwql dataset over "${tableName}": column "${sourceColumn}" is an ` +
          `aggregate-function state (${type}) but the dataset is not marked ` +
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
  skipColumns: Readonly<Record<string, string>>;
}): ExposedColumn[] {
  const columnByName = new Map(
    manifestTable.columns.map((column) => [column.name, column]),
  );

  for (const skipped of Object.keys(skipColumns)) {
    if (!columnByName.has(skipped)) {
      throw new Error(
        `lwql dataset over "${manifestTable.name}": skipColumns names ` +
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
    skipColumns = {},
    descriptions = {},
    tenantColumn,
    manifest,
  } = input;

  const manifestTable = columnsManifestTable(manifest, table);
  const exposed = exposedColumns({ manifestTable, aliases, skipColumns });

  const columns: LangWatchQLViewColumn[] = exposed.map((column) => {
    const unit = columnUnits[column.exposedName];
    const projected = projectColumn({
      sourceColumn: column.sourceColumn,
      type: column.type,
      aggregating: dedup.aggregating === true,
      tableName: manifestTable.name,
    });
    return {
      name: column.exposedName,
      type: projected.type,
      description:
        descriptions[column.exposedName] ??
        (column.comment || column.exposedName),
      gates: columnGates[column.exposedName] ?? [],
      sourceColumns: [column.sourceColumn],
      ...(projected.expression ? { expression: projected.expression } : {}),
      ...(projected.aggregate ? { aggregate: true } : {}),
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

/**
 * Column-name suffixes that mark an identifier/label, never free-text content.
 *
 * Two spellings, because the tables mix conventions: camelCase columns
 * (`TraceId`, `MetricName`) and the snake_case ones a table like `stored_objects`
 * carries (`owner_id`, `media_type`, `sha256`, `storage_uri`). `Model` (a model
 * name) and `Label` (a categorical outcome) are labels too, matching how the
 * hand-written `evaluations`/`model_usage_by_minute` views expose them. A missed
 * identifier is not merely a cosmetic mislabel: the validator gates by
 * lowercased leaf name across the whole catalog, so a bare `id` wrongly gated on
 * one dataset withholds `Id` on every other — which is exactly the collision
 * this widening removes.
 */
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

/**
 * The caller-facing name a view gets by default.
 *
 * ── Naming decision (the one place it is recorded) ──
 * A view's name MUST differ from every physical table name. This is not a
 * stylistic preference, it is technically required: self-hosted provisioning
 * creates the LangWatchQL views in the *same* ClickHouse database as the fact
 * tables (`selfProvisioning.ts` refuses `names.database !== sourceDatabase`), so
 * a view named after its source table would `CREATE OR REPLACE VIEW` over — or
 * collide with — the real table. Two guards enforce it: `lwqlAllowedTables`
 * (catalog-wide, `lwqlViewCatalog.unit.test.ts`) and a check against the actual
 * migrations (`lwqlCatalogCollision.unit.test.ts`).
 *
 * Because it is required, the renames are kept (not removed) — each override
 * picks a clear caller-facing name (`automation_audit` → `automation_events`,
 * `coding_agent_trace_sessions` → `coding_trace_sessions`, …) rather than a
 * mechanical `_v` suffix: a readable name is better UX than the table name plus
 * a marker, and these names are already bound in the feature file, docs and the
 * Go manifest. The one mechanical default here strips a `stored_` prefix; every
 * other colliding table names itself in its override.
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
    const skipColumns = override.skipColumns ?? {};
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
    // Grain and key columns are exposed under the names a caller sees: a source
    // column renamed by an alias (`CorrelationTraceId` → `TraceId`) appears in
    // the grain as `TraceId`, so the fanout diagnostic and the schema endpoint
    // speak the caller's vocabulary. The dedup body maps each back to its
    // physical source column (`lwqlPhysicalColumn`).
    const reverseAlias: Record<string, string> = {};
    for (const [exposed, physical] of Object.entries(aliases)) {
      reverseAlias[physical] = exposed;
    }
    const exposedOf = (physical: string): string =>
      reverseAlias[physical] ?? physical;
    const exposedSortKey = sortKey.map(exposedOf);
    // An aggregating source keeps the whole engine key as its grain: the view
    // renders `GROUP BY` the grain, so the tenant column must stay in it or the
    // group would merge every tenant's rows into one. A superseding source
    // strips it — its `in-tuple` dedup runs under a row policy already scoped to
    // one tenant, so grouping by the rest is right and narrower.
    const aggregating = override.dedup?.aggregating === true;
    const grainColumns =
      override.grainColumns ??
      (aggregating
        ? exposedSortKey
        : sortKey.filter((column) => column !== tenantColumn).map(exposedOf));
    const timeColumn = override.timeColumn ?? defaultTimeColumn(manifestTable);
    const name = override.name ?? defaultDatasetName(manifestTable.name);
    // An aggregating dataset must advertise its whole bucket key as its join
    // keys: every measure is a merge, so a join on a prefix would add several
    // buckets' measures under one row rather than repeat it. A superseding
    // dataset advertises TenantId (every dataset is narrowable on it — see the
    // schema-catalog guard "lists an ungated, joinable TenantId column") plus
    // its shared `*Id` foreign keys.
    const joinKeys = aggregating
      ? grainColumns
      : [
          DEFAULT_TENANT_COLUMN,
          ...(override.joinKeys ??
            defaultJoinKeys({ manifestTable, sharedColumns })),
        ].filter((key, index, all) => all.indexOf(key) === index);

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
      joinKeys,
      timeColumn,
      freshness: override.freshness ?? DEFAULT_FRESHNESS,
      ...(override.gates ? { gates: override.gates } : {}),
      dedup: defaultDedup({
        sortKey: exposedSortKey,
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
