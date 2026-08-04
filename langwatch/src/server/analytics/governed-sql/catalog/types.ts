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
 * What a column's numbers are measured in.
 *
 * A closed vocabulary, and deliberately short: a unit is here because a column
 * genuinely has one, not so that every column can carry a label. A count has no
 * unit beyond the thing counted, which its name already says, and a score is
 * whatever the evaluator decided — publishing "score" as a unit would be
 * inventing a fact. Written with the standard symbol where one exists, because
 * `ms` and `USD` are the notation, not an abbreviation of the word.
 */
export const GOVERNED_COLUMN_UNITS = [
  "ms",
  "USD",
  "tokens",
  "tokens/s",
] as const;

export type GovernedColumnUnit = (typeof GOVERNED_COLUMN_UNITS)[number];

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
   * What the values are measured in, when they are measured in anything.
   *
   * Absent is the honest answer for an identifier, a flag, a name, a count or a
   * score — and it is a different answer from a unit nobody got round to
   * filling in, which is why there is no placeholder value.
   */
  readonly unit?: GovernedColumnUnit;
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

/** What identifies one row of a view, and how the source's versions collapse to it. */
export interface GovernedViewDedup {
  /**
   * Columns identifying one logical row — the source table's `ORDER BY`.
   *
   * This is the dataset's grain, which is what the fanout diagnostic reads to
   * decide whether a join can multiply rows. Only these narrow both scopes of
   * the dedup. A range filter on a business-time column inside the `max()`
   * scope silently returns stale rows: if the newest version moved out of the
   * range, the subquery reports an older version's stamp and the outer scope
   * matches that older row.
   */
  readonly keyColumns: readonly string[];
  /**
   * The engine's version column: `argMax`/`max` over this picks the survivor.
   *
   * Absent when the source keeps exactly one row per key and there is nothing
   * to collapse — every PostgreSQL-resident dataset, where the row *is* the
   * current state. Omitted rather than defaulted, so that a `ReplacingMergeTree`
   * whose version column was forgotten is a missing field rather than a view
   * that silently double-counts.
   */
  readonly versionColumn?: string;
}

/**
 * How a PostgreSQL-resident dataset reaches the governed ClickHouse schema.
 *
 * Its presence on an entry is what makes that dataset PostgreSQL-resident —
 * there is no separate residence flag to disagree with it. The chain is:
 *
 *  1. `baseRelation` — the application's own table, which the analytics reader
 *     role is never granted anything on.
 *  2. `approvedView` — a view over it exposing exactly the catalog's columns,
 *     under the catalog's names. The reader role holds `SELECT` on this and
 *     nothing else, which is what makes an unexposed column *unreachable*
 *     rather than merely unselected.
 *  3. {@link GovernedViewDefinition.sourceTable} — the PostgreSQL-engine table
 *     in the governed database, mapping the approved view through the
 *     server-side named collection. The row policy sits here.
 *  4. The governed view the caller names, over that engine table.
 *
 * @see ../provisioning.ts — the approved view, the engine table and the role
 * @see ../views.ts — the governed view and its tenant predicate
 */
export interface GovernedPostgresMapping {
  /** Table in the application's PostgreSQL schema. Never granted to the reader. */
  readonly baseRelation: string;
  /** View over it exposing the catalog's columns. The reader's only relation. */
  readonly approvedView: string;
  /**
   * Column of {@link baseRelation} holding the owning project.
   *
   * Named separately from the exposed `TenantId` because the application's
   * schema calls it something else on every table, and the approved view is
   * what reconciles the two.
   */
  readonly tenantSourceColumn: string;
}

/**
 * A governed view: what a caller may read, and everything the endpoint has to
 * publish about it.
 */
export interface GovernedViewDefinition {
  /** Name inside the governed database. The `analytics.<name>` a caller writes. */
  readonly name: string;
  /**
   * Table the view reads.
   *
   * For a ClickHouse-resident dataset, the fact table in the application's
   * database. For a PostgreSQL-resident one, the PostgreSQL-engine table in the
   * governed database — see {@link GovernedViewDefinition.postgres}.
   */
  readonly sourceTable: string;
  /**
   * How this dataset reaches ClickHouse, when it does not live there.
   *
   * Absent for a ClickHouse-resident dataset, which is most of them.
   */
  readonly postgres?: GovernedPostgresMapping;
  /** One line for the schema endpoint. */
  readonly description: string;
  /**
   * Permissions a caller must hold to reach the dataset at all.
   *
   * Every column inherits them ({@link governedColumnGates}), which is what
   * makes a dataset the caller may not reach *absent* from the published
   * schema and refused by the validator, rather than merely awkward to use.
   * Declared explicitly rather than defaulted, so that adding a dataset means
   * answering the question.
   *
   * Empty for every dataset shipped today: none of them is content in its
   * entirety — a caller with no content permission can still count runs, read
   * verdicts and group by model. A dataset that *is* content end to end — a raw
   * conversation store — is what this exists for.
   */
  readonly gates: readonly FieldProtection[];
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

/**
 * Whether a column carries captured customer content.
 *
 * Reads the column's own gates only. The view generator uses this to decide
 * what a view's SQL must filter out, and a dataset-level gate says who may read
 * the dataset rather than what the values are — a distinction that matters,
 * because a view has no viewer and cannot filter by permission.
 */
export function isContentGated(column: GovernedViewColumn): boolean {
  return column.gates.includes("input") || column.gates.includes("output");
}

/**
 * Every permission a caller needs to reference one column: the dataset's, then
 * the column's own.
 *
 * The union rather than either half, because both are real. A column of a
 * gated dataset is unreadable for two independent reasons and the schema
 * endpoint publishes both, so a caller told what to ask for is told all of it.
 */
export function governedColumnGates({
  view,
  column,
}: {
  view: GovernedViewDefinition;
  column: GovernedViewColumn;
}): readonly FieldProtection[] {
  if (view.gates.length === 0) return column.gates;
  return [...new Set([...view.gates, ...column.gates])];
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
      ...(view.dedup.versionColumn ? [view.dedup.versionColumn] : []),
    ]),
  ].sort();
}

/**
 * Whether a dataset's rows live in PostgreSQL and reach ClickHouse through the
 * named-collection mapping.
 *
 * Reads the mapping's presence rather than a flag beside it, so there is
 * nothing to keep in agreement.
 */
export function isPostgresResident(
  view: GovernedViewDefinition,
): view is GovernedViewDefinition & { postgres: GovernedPostgresMapping } {
  return view.postgres !== undefined;
}

/** The PostgreSQL-resident datasets of a catalog, in catalog order. */
export function governedPostgresViews(
  views: readonly GovernedViewDefinition[],
): readonly (GovernedViewDefinition & { postgres: GovernedPostgresMapping })[] {
  return views.filter(isPostgresResident);
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
  const held = heldPermissions(protections);
  const withheld = views.flatMap((view) =>
    view.columns
      .filter((column) =>
        governedColumnGates({ view, column }).some((gate) => !held.has(gate)),
      )
      .map((column) => column.name),
  );
  return [...new Set(withheld)].sort();
}

/**
 * The permissions a caller holds.
 *
 * Fail-closed: only an explicit `true` counts, so the shape
 * `getUserProtectionsForProject` returns when the policy resolver is down
 * grants nothing.
 */
function heldPermissions(protections: Protections): ReadonlySet<FieldProtection> {
  const held = new Set<FieldProtection>();
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  if (protections.canSeeCosts === true) held.add("costs");
  return held;
}

/**
 * The datasets a caller can reach, in catalog order.
 *
 * A dataset drops out when the caller may read nothing in it — either because
 * the dataset itself is gated on a permission they lack, or because every one
 * of its columns is. Those are the same fact from two directions, so they are
 * one rule rather than two: what makes a dataset absent is that there is
 * nothing in it for this caller, however that came about.
 *
 * The schema endpoint publishes exactly these. The validator needs no separate
 * arrangement — every column of an absent dataset is in
 * {@link governedGatedColumns}, so referencing one is refused.
 */
export function governedVisibleViews({
  protections,
  views,
}: {
  protections: Protections;
  views: readonly GovernedViewDefinition[];
}): readonly GovernedViewDefinition[] {
  const held = heldPermissions(protections);
  return views.filter((view) =>
    view.columns.some((column) =>
      governedColumnGates({ view, column }).every((gate) => held.has(gate)),
    ),
  );
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
