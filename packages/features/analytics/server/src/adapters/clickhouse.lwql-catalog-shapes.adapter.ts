/**
 * LangWatchQL analytics SQL — the shape of the schema catalog.
 * @see ./lwql-views.ts — the catalog itself
 * @see specs/analytics/lwql-api.feature
 */

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { FieldProtection } from "../rules/lwql-field-protection.rules";

/**
 * What a column's numbers are measured in.
 */
export const LWQL_COLUMN_UNITS = ["ms", "USD", "tokens", "tokens/s"] as const;

export type LangWatchQLColumnUnit = (typeof LWQL_COLUMN_UNITS)[number];

/**
 * How a view collapses its source's rows to one per logical record.
 * @see ../views.ts — how each is rendered, and the measurement that chose the default
 */
export type LangWatchQLDedupStrategy = "in-tuple" | "final" | "none";

/**
 * One exposed column.
 */
export interface LangWatchQLViewColumn {
  /** Name as the view exposes it. What a caller writes. */
  readonly name: string;
  /** ClickHouse type, exactly as `system.columns` reports it for the view. */
  readonly type: string;
  /** One line, for the schema endpoint. Says what the value means, not how it is stored. */
  readonly description: string;
  /**
   * What the values are measured in, when they are measured in anything.
   */
  readonly unit?: LangWatchQLColumnUnit;
  /**
   * Permissions a caller must hold to reference this column, all of them.
   */
  readonly gates: readonly FieldProtection[];
  /**
   * Columns of the source table this one reads.
   */
  readonly sourceColumns: readonly string[];
  /**
   * Set when the source stores this column as `SimpleAggregateFunction(sum, T)`
   * and the view must read it back as plain `T`.
   */
  readonly summed?: boolean;
  /**
   * SQL over the source table producing this column. Defaults to the single
   * entry in {@link sourceColumns} when the column is passed through unchanged.
   */
  readonly expression?: (source: (column: string) => string) => string;
}

/** What identifies one row of a view, and how the source's versions collapse to it. */
export interface LangWatchQLViewDedup {
  /**
   * The source table's `ORDER BY` — the key its engine collapses on.
   */
  readonly keyColumns: readonly string[];
  /**
   * The strategy this dataset needs, when the shipped default is wrong for it.
   */
  readonly strategy?: LangWatchQLDedupStrategy;
  /**
   * The engine's version column: `argMax`/`max` over this picks the survivor.
   */
  readonly versionColumn?: string;
  /**
   * Set when the source is an `AggregatingMergeTree`, whose rows for one key are
   * *summed together* rather than one superseding the others.
   */
  readonly aggregating?: boolean;
}

/**
 * How a PostgreSQL-resident dataset reaches the LangWatchQL ClickHouse schema.
 * @see ../provisioning.ts — the approved view, the engine table and the role
 * @see ../views.ts — the LangWatchQL view and its tenant predicate
 */
export interface LangWatchQLPostgresMapping {
  /** Table in the application's PostgreSQL schema. Never granted to the reader. */
  readonly baseRelation: string;
  /** View over it exposing the catalog's columns. The reader's only relation. */
  readonly approvedView: string;
  /**
   * Column of {@link baseRelation} holding the owning project.
   */
  readonly tenantSourceColumn: string;
}

/**
 * A LangWatchQL view: what a caller may read, and everything the endpoint has to
 * publish about it.
 */
export interface LangWatchQLViewDefinition {
  /** Name inside the LangWatchQL database. The `analytics.<name>` a caller writes. */
  readonly name: string;
  /**
   * Table the view reads.
   */
  readonly sourceTable: string;
  /**
   * How this dataset reaches ClickHouse, when it does not live there.
   *
   * Absent for a ClickHouse-resident dataset, which is most of them.
   */
  readonly postgres?: LangWatchQLPostgresMapping;
  /** One line for the schema endpoint. */
  readonly description: string;
  /**
   * Permissions a caller must hold to reach the dataset at all.
   */
  readonly gates: readonly FieldProtection[];
  /** What one row of the view is, after deduplication. */
  readonly grain: string;
  /**
   * {@link LangWatchQLViewDefinition.grain} as columns: the identity of one
   * logical row.
   */
  readonly grainColumns?: readonly string[];
  /** Columns another LangWatchQL view can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /**
   * The column a caller should filter to prune partitions.
   */
  readonly timeColumn: string;
  /** How far behind the write path this view can be, for the schema endpoint. */
  readonly freshness: string;
  readonly dedup: LangWatchQLViewDedup;
  readonly columns: readonly LangWatchQLViewColumn[];
}

/**
 * Whether a column carries captured customer content.
 */
export function isContentGated(column: LangWatchQLViewColumn): boolean {
  return column.gates.includes("input") || column.gates.includes("output");
}

/**
 * Every permission a caller needs to reference one column: the dataset's, then
 * the column's own.
 */
export function lwqlColumnGates({
  view,
  column,
}: {
  view: LangWatchQLViewDefinition;
  column: LangWatchQLViewColumn;
}): readonly FieldProtection[] {
  if (view.gates.length === 0) return column.gates;
  return [...new Set([...view.gates, ...column.gates])];
}

/**
 * The plain numeric types a summed measure can be read back as.
 */
const SUMMED_COLUMN_TYPE = /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64))$/;

/**
 * The columns identifying one logical row of a dataset.
 */
export function lwqlGrainColumns(view: LangWatchQLViewDefinition): readonly string[] {
  return view.grainColumns ?? view.dedup.keyColumns;
}

/**
 * SQL producing a column from the source table.
 */
export function columnExpression({
  column,
  source,
  isAggregated = false,
}: {
  readonly column: LangWatchQLViewColumn;
  readonly source: (name: string) => string;
  readonly isAggregated?: boolean;
}): string {
  if (column.expression) {
    // Refused rather than resolved in either direction: a summed measure's SQL
    // is derived from its own name and type precisely so that no second
    // statement of them can drift, and honouring an expression here would
    // reopen the mislabelling `summed` exists to close.
    if (column.summed) {
      throw new Error(
        `lwql catalog: column "${column.name}" is a summed measure and also declares an ` +
          `expression; the cast is derived from the column itself, so an expression could name another one`,
      );
    }
    return column.expression(source);
  }
  if (column.sourceColumns.length !== 1) {
    throw new Error(
      `lwql catalog: column "${column.name}" reads ${column.sourceColumns.length} source columns ` +
        `and must declare an expression`,
    );
  }
  // Reported separately from the count, because a single empty name satisfies
  // the count and would otherwise be blamed on it — sending whoever reads the
  // failure to look for a missing expression that is not the problem.
  const [only] = column.sourceColumns;
  if (!only) {
    throw new Error(`lwql catalog: column "${column.name}" declares an empty source column name`);
  }
  if (!column.summed) return source(only);
  if (!SUMMED_COLUMN_TYPE.test(column.type)) {
    throw new Error(
      `lwql catalog: summed column "${column.name}" declares type "${column.type}", which is not a ` +
        `plain numeric type the merged total can be cast to`,
    );
  }
  // Under a `GROUP BY` render the merge has not run for the view — the group
  // is what performs it — so the measure is summed explicitly; elsewhere the
  // merged total is already in the column and only the cast is needed.
  const merged = isAggregated ? `sum(${source(only)})` : source(only);
  return `to${column.type}(${merged})`;
}

/**
 * Every source column a view reads, deduplicated and sorted.
 */
export function lwqlViewSourceColumns(view: LangWatchQLViewDefinition): readonly string[] {
  return [
    ...new Set([
      ...view.columns.flatMap((column) => column.sourceColumns),
      ...view.dedup.keyColumns,
      ...(view.dedup.versionColumn ? [view.dedup.versionColumn] : []),
    ]),
  ].sort();
}

/**
 * Whether a dataset's rows live in PostgreSQL and reach ClickHouse through the
 * named-collection mapping.
 */
export function isPostgresResident(
  view: LangWatchQLViewDefinition,
): view is LangWatchQLViewDefinition & {
  postgres: LangWatchQLPostgresMapping;
} {
  return view.postgres !== undefined;
}

/** The PostgreSQL-resident datasets of a catalog, in catalog order. */
export function lwqlPostgresViews(
  views: readonly LangWatchQLViewDefinition[],
): readonly (LangWatchQLViewDefinition & {
  postgres: LangWatchQLPostgresMapping;
})[] {
  return views.filter(isPostgresResident);
}

/**
 * The validator's `allowedTables`, qualified with the LangWatchQL database.
 */
export function lwqlAllowedTables({
  database,
  views,
}: {
  database: string;
  views: readonly LangWatchQLViewDefinition[];
}): readonly string[] {
  return views.map((view) => `${database}.${view.name}`);
}

/**
 * The validator's `gatedColumns` for one caller.
 */
export function lwqlGatedColumns({
  protections,
  views,
}: {
  protections: LangWatchQLProtections;
  views: readonly LangWatchQLViewDefinition[];
}): readonly string[] {
  const held = heldPermissions(protections);
  const withheld = views.flatMap((view) =>
    view.columns
      .filter((column) => lwqlColumnGates({ view, column }).some((gate) => !held.has(gate)))
      .map((column) => column.name),
  );
  return [...new Set(withheld)].sort();
}

/**
 * The permissions a caller holds.
 */
function heldPermissions(protections: LangWatchQLProtections): ReadonlySet<FieldProtection> {
  const held = new Set<FieldProtection>();
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  if (protections.canSeeCosts === true) held.add("costs");
  return held;
}

/**
 * The datasets a caller can reach, in catalog order.
 */
export function lwqlVisibleViews({
  protections,
  views,
}: {
  protections: LangWatchQLProtections;
  views: readonly LangWatchQLViewDefinition[];
}): readonly LangWatchQLViewDefinition[] {
  const held = heldPermissions(protections);
  return views.filter((view) =>
    view.columns.some((column) =>
      lwqlColumnGates({ view, column }).every((gate) => held.has(gate)),
    ),
  );
}

/** Every column of every view that carries captured content, sorted. */
export function lwqlContentGatedColumns(
  views: readonly LangWatchQLViewDefinition[],
): readonly string[] {
  return [
    ...new Set(
      views.flatMap((view) => view.columns.filter(isContentGated).map((column) => column.name)),
    ),
  ].sort();
}
