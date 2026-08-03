/**
 * Governed analytics SQL — the shape of the schema catalog.
 *
 * The catalog is *data*: one entry per governed view, describing what it is
 * made of and what governs it. Three consumers read it, and the shapes here
 * exist so each of them is a projection rather than a re-derivation:
 *
 *  - the schema-discovery endpoint, which publishes grain, freshness, join
 *    keys, types and descriptions;
 *  - the AST validator, whose `allowedTables` and `gatedColumns` come from
 *    {@link governedAllowedTables} and {@link governedGatedColumns};
 *  - the provisioning generators in `../views.ts`, which turn an entry into its
 *    `CREATE VIEW`, its column grants and its row policy.
 *
 * Nothing here holds SQL text or database names. A view's *source database* is
 * a deployment fact (`langwatch` in production, a per-suite database under
 * test), so it is passed to the generators instead of being baked into an entry
 * that would then be wrong everywhere else.
 *
 * @see ./governedViews.ts — the catalog itself
 * @see specs/analytics/governed-sql-api.feature
 */

import type { FieldProtection } from "../../../traces/projection/catalog";
import type { Protections } from "../../../traces/protections";

/**
 * One exposed column.
 *
 * `gates` is a set rather than a single value because a column can require more
 * than one permission: a simulation transcript is both what the user said and
 * what the model answered, so it is visible only to a caller holding both. An
 * empty list is an ungated column.
 */
export interface GovernedViewColumn {
  /** Name as the view exposes it. What a caller writes. */
  readonly name: string;
  /** ClickHouse type, exactly as `system.columns` reports it for the view. */
  readonly type: string;
  /** One line, for the schema endpoint. Says what the value means, not how it is stored. */
  readonly description: string;
  /**
   * Permissions a caller must hold to reference this column, all of them.
   *
   * Every entry traces to the canonical visibility policy: `input` / `output`
   * are `Protections.canSeeCapturedInput` / `canSeeCapturedOutput`, `costs` is
   * `Protections.canSeeCosts`.
   */
  readonly gates: readonly FieldProtection[];
  /**
   * Columns of the source table this one reads.
   *
   * The union over a view is exactly what the restricted identity is granted on
   * the underlying table — the grant is derived from the catalog, so a column
   * that is not exposed is not readable, rather than merely not selected.
   */
  readonly sourceColumns: readonly string[];
  /**
   * SQL over the source table producing this column. Defaults to the single
   * entry in {@link sourceColumns} when the column is passed through unchanged.
   *
   * A function of `source`, not a string, because a source column referenced by
   * its bare name inside a view body resolves to the *projection alias* of the
   * same name rather than to the table's column. The span view exposes a
   * content-filtered `SpanAttributes` and reads the caller's input out of the
   * unfiltered one; written bare, the second reference picked up the first's
   * alias and `CapturedInput` came back empty for every span. Passing the
   * qualifier in is what makes forgetting impossible rather than remembered.
   */
  readonly expression?: (source: (column: string) => string) => string;
}

/** How a view collapses a `ReplacingMergeTree`'s versions to one row. */
export interface GovernedViewDedup {
  /**
   * Columns identifying one logical row — the source table's `ORDER BY`.
   *
   * Only these narrow both scopes of the dedup. A range filter on a business
   * -time column inside the `max()` scope silently returns stale rows: if the
   * newest version moved out of the range, the subquery reports an older
   * version's stamp and the outer scope matches that older row.
   */
  readonly keyColumns: readonly string[];
  /** The engine's version column: `argMax`/`max` over this picks the survivor. */
  readonly versionColumn: string;
}

/**
 * A governed view: what a caller may read, and everything the endpoint has to
 * publish about it.
 */
export interface GovernedViewDefinition {
  /** Name inside the governed database. The `analytics.<name>` a caller writes. */
  readonly name: string;
  /** Table in the source database the view reads. */
  readonly sourceTable: string;
  /** One line for the schema endpoint. */
  readonly description: string;
  /** What one row of the view is, after deduplication. */
  readonly grain: string;
  /** Columns another governed view can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /**
   * The column a caller should filter to prune partitions.
   *
   * The source table partitions on a function of this column, so a query
   * without a predicate on it reads every partition the tenant has, including
   * whatever has aged onto object storage.
   */
  readonly timeColumn: string;
  /** How far behind the write path this view can be, for the schema endpoint. */
  readonly freshness: string;
  readonly dedup: GovernedViewDedup;
  readonly columns: readonly GovernedViewColumn[];
}

/** Whether a column carries captured customer content. */
export function isContentGated(column: GovernedViewColumn): boolean {
  return column.gates.includes("input") || column.gates.includes("output");
}

/**
 * SQL producing a column from the source table.
 *
 * `source` qualifies one of the source table's columns — see
 * {@link GovernedViewColumn.expression} for why every reference must go through
 * it.
 */
export function columnExpression(
  column: GovernedViewColumn,
  source: (name: string) => string,
): string {
  if (column.expression) return column.expression(source);
  const [only] = column.sourceColumns;
  if (!only || column.sourceColumns.length !== 1) {
    throw new Error(
      `governed-sql catalog: column "${column.name}" reads ${column.sourceColumns.length} source columns ` +
        `and must declare an expression`,
    );
  }
  return source(only);
}

/**
 * Every source column a view reads, deduplicated and sorted.
 *
 * Includes the dedup key and version columns even when no exposed column is
 * built from them: without a grant on those the view's own `IN`-tuple cannot be
 * evaluated, and the view fails with an access error rather than a wrong
 * answer — a failure mode that looks like a broken catalog and is really a
 * missing grant.
 */
export function governedViewSourceColumns(
  view: GovernedViewDefinition,
): readonly string[] {
  return [
    ...new Set([
      ...view.columns.flatMap((column) => column.sourceColumns),
      ...view.dedup.keyColumns,
      view.dedup.versionColumn,
    ]),
  ].sort();
}

/**
 * The validator's `allowedTables`, qualified with the governed database.
 *
 * The source tables are deliberately absent: a caller names `analytics.traces`,
 * never the physical table behind it, so the physical names stay out of error
 * messages as well as out of queries.
 */
export function governedAllowedTables({
  database,
  views,
}: {
  database: string;
  views: readonly GovernedViewDefinition[];
}): readonly string[] {
  return views.map((view) => `${database}.${view.name}`);
}

/**
 * The validator's `gatedColumns` for one caller.
 *
 * Fail-closed on purpose: a permission is withheld unless it is explicitly
 * `true`, so an unresolved `Protections` (the shape `getUserProtectionsForProject`
 * returns when the policy resolver is down) gates everything rather than
 * nothing. Matches how the trace read path reads the same flags.
 */
export function governedGatedColumns({
  protections,
  views,
}: {
  protections: Protections;
  views: readonly GovernedViewDefinition[];
}): readonly string[] {
  const held = new Set<FieldProtection>();
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  if (protections.canSeeCosts === true) held.add("costs");

  const withheld = views.flatMap((view) =>
    view.columns
      .filter((column) => column.gates.some((gate) => !held.has(gate)))
      .map((column) => column.name),
  );
  return [...new Set(withheld)].sort();
}

/** Every column of every view that carries captured content, sorted. */
export function governedContentGatedColumns(
  views: readonly GovernedViewDefinition[],
): readonly string[] {
  return [
    ...new Set(
      views.flatMap((view) =>
        view.columns.filter(isContentGated).map((column) => column.name),
      ),
    ),
  ].sort();
}
