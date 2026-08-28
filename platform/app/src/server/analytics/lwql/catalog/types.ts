/**
 * LangWatchQL analytics SQL — the shape of the schema catalog.
 *
 * The catalog is *data*: one entry per LangWatchQL view, describing what it is
 * made of and what governs it. Three consumers read it, and the shapes here
 * exist so each of them is a projection rather than a re-derivation:
 *
 *  - the schema-discovery endpoint, which publishes grain, freshness, join
 *    keys, types and descriptions;
 *  - the AST validator, whose `allowedTables` and `gatedColumns` come from
 *    {@link lwqlAllowedTables} and {@link lwqlGatedColumns};
 *  - the provisioning generators in `../views.ts`, which turn an entry into its
 *    `CREATE VIEW`, its column grants and its row policy.
 *
 * Nothing here holds SQL text or database names. A view's *source database* is
 * a deployment fact (`langwatch` in production, a per-suite database under
 * test), so it is passed to the generators instead of being baked into an entry
 * that would then be wrong everywhere else.
 *
 * @see ./lwqlViews.ts — the catalog itself
 * @see specs/analytics/lwql-api.feature
 */

import type { FieldProtection } from "../../../traces/projection/catalog";
import type { Protections } from "@langwatch/trace-server";

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
export const LWQL_COLUMN_UNITS = ["ms", "USD", "tokens", "tokens/s"] as const;

export type LangWatchQLColumnUnit = (typeof LWQL_COLUMN_UNITS)[number];

/**
 * How a view collapses its source's rows to one per logical record.
 *
 * A choice with a measurement behind it rather than a preference, so it is a
 * parameter: the isolation suite measures each against the real tables and the
 * shipped default is whichever won. See `../views.ts` for the measurement, and
 * {@link LangWatchQLViewDedup.strategy} for the entry that pins its own.
 *
 *  - `in-tuple` — the repository pattern from
 *    `dev/docs/best_practices/clickhouse-queries.md`: an `IN` over
 *    `(grain columns…, max(version))`. Correct whatever the engine's sort key
 *    is, and the inner scope carries no predicate from the caller's query, so
 *    it reads the tenant's whole history on every query however narrow the
 *    caller's time filter is.
 *  - `final` — `FROM … FINAL`. The caller's `WHERE` reaches the read, so a time
 *    predicate prunes partitions in the only scope there is. Collapses on the
 *    *table's* `ORDER BY` and nothing else, which is why a source whose sort key
 *    carries a moving column needs `in-tuple` instead.
 *  - `none` — no deduplication. Exposes every unmerged version as its own row,
 *    which silently doubles aggregates. Here to be measured against, never to
 *    be shipped, and never to be pinned on an entry.
 *
 * @see ../views.ts — how each is rendered, and the measurement that chose the default
 */
export type LangWatchQLDedupStrategy = "in-tuple" | "final" | "none";

/**
 * One exposed column.
 *
 * `gates` is a set rather than a single value because a column can require more
 * than one permission: a simulation transcript is both what the user said and
 * what the model answered, so it is visible only to a caller holding both. An
 * empty list is an ungated column.
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
   *
   * Absent is the honest answer for an identifier, a flag, a name, a count or a
   * score — and it is a different answer from a unit nobody got round to
   * filling in, which is why there is no placeholder value.
   */
  readonly unit?: LangWatchQLColumnUnit;
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
   * Set when the source stores this column as `SimpleAggregateFunction(sum, T)`
   * and the view must read it back as plain `T`.
   *
   * A flag rather than an expression, because the expression is the one place a
   * measure can be *mislabelled* and nothing notices: written by hand, every
   * summed column says its own name and its own cast a second time, and a
   * copy-paste that leaves `TraceCount` reading `SpanCount` still type-checks,
   * still returns a number, and still passes a fixture whose measures share a
   * value. Declared this way the cast is derived centrally — `to<type>` over
   * this column's single source column — so the three facts cannot disagree.
   *
   * The cast is what keeps the published type a type a caller can reason about.
   * Measured against 25.10.2.65, a view that passes such a column straight
   * through reports it to `system.columns` — and therefore to the schema
   * endpoint — as `SimpleAggregateFunction(sum, UInt64)`, which tells the caller
   * nothing except which storage engine is underneath. The values are identical
   * either way: the merge has already run by the time the projection does, so
   * the cast reads the merged total, not one part's share of it.
   */
  readonly summed?: boolean;
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
export interface LangWatchQLViewDedup {
  /**
   * The source table's `ORDER BY` — the key its engine collapses on.
   *
   * A statement about the *table*, not about the dataset: `FINAL` merges by this
   * key and nothing else, so it is what the `final` strategy can promise. What
   * one row of the dataset *is* — the grain a join has to match to avoid
   * multiplying rows — is {@link LangWatchQLViewDefinition.grainColumns}, which is
   * the same list on every source whose sort key holds still and a narrower one
   * where it does not.
   *
   * Checked against `system.tables.sorting_key` by the integration suite, so an
   * entry that gets it wrong is a red test rather than a diagnostic that quietly
   * describes a key the engine is not using.
   */
  readonly keyColumns: readonly string[];
  /**
   * The strategy this dataset needs, when the shipped default is wrong for it.
   *
   * Absent on almost every entry: the default is measured and applies to every
   * source whose sort key is stable. Present where a source's sort key carries a
   * column the write path *moves* — `evaluation_analytics` writes its progress
   * watermark into `OccurredAt`, which is second in its sort key — because
   * `FINAL` then collapses nothing (two lifecycle versions of one evaluation
   * carry two `OccurredAt`s, so they are two different sort keys) and every
   * `sum`, `count` and `avg` a caller writes counts the row twice. The owning
   * repositories refuse `FINAL` on those tables for exactly this reason.
   *
   * `none` must never be pinned here — it is a measurement baseline, and an
   * entry naming it would ship undeduplicated rows.
   */
  readonly strategy?: LangWatchQLDedupStrategy;
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
  /**
   * Set when the source is an `AggregatingMergeTree`, whose rows for one key
   * are *summed together* rather than one superseding the others.
   *
   * The third answer to "which row survives", and it has to be declared because
   * it cannot be inferred from the other two. An absent `versionColumn` already
   * means "nothing to collapse" (the PostgreSQL-resident datasets), and reading
   * this engine that way would expose every unmerged partial row as its own
   * result row — a caller's `SELECT CostSum` would see a fraction of the
   * bucket's cost, which looks like a real number rather than like an error.
   *
   * The survivor is the merge, so there is no version to pick and
   * {@link versionColumn} must stay absent; the key columns must be the
   * source's whole `ORDER BY`, since that is what the engine merges on. `FINAL`
   * performs the merge where the published grain is that whole key; where the
   * grain is narrower, the view aggregates instead — `GROUP BY` the grain with
   * every measure summed, which subsumes the merge — because `FINAL` can only
   * collapse to the key and the surplus key columns would surface as extra rows
   * per logical row.
   */
  readonly aggregating?: boolean;
}

/**
 * How a PostgreSQL-resident dataset reaches the LangWatchQL ClickHouse schema.
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
 *  3. {@link LangWatchQLViewDefinition.sourceTable} — the PostgreSQL-engine table
 *     in the LangWatchQL database, mapping the approved view through the
 *     server-side named collection. The row policy sits here.
 *  4. The LangWatchQL view the caller names, over that engine table.
 *
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
   *
   * Named separately from the exposed `TenantId` because the application's
   * schema calls it something else on every table, and the approved view is
   * what reconciles the two.
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
   *
   * For a ClickHouse-resident dataset, the fact table in the application's
   * database. For a PostgreSQL-resident one, the PostgreSQL-engine table in the
   * LangWatchQL database — see {@link LangWatchQLViewDefinition.postgres}.
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
   *
   * Every column inherits them ({@link lwqlColumnGates}), which is what
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
  /**
   * {@link LangWatchQLViewDefinition.grain} as columns: the identity of one
   * logical row.
   *
   * Three consumers read it, and they are the reason it is separate from
   * {@link LangWatchQLViewDedup.keyColumns}. The fanout diagnostic asks whether a
   * join matched enough of a dataset's identity for one row to meet one row —
   * a question about the *dataset*, where the engine's sort key can be wider
   * and reporting the surplus as unmatched is a false alarm on the join the
   * schema endpoint itself advertises. The `in-tuple` strategy groups by it, so
   * what the view collapses on and what the diagnostic calls a row are one
   * declaration rather than two that have to agree. And an *aggregating* source
   * whose grain is narrower than its key is rendered as a `GROUP BY` over it —
   * see {@link LangWatchQLViewDedup.aggregating}.
   *
   * Declaring it is therefore a claim the strategy has to be able to honour:
   * under plain `FINAL` the engine collapses to its own sort key and nothing
   * narrower, so a `FINAL` dataset whose declared grain is narrower than the
   * key would publish a grain the view cannot deliver. The catalog guard
   * enforces this.
   *
   * Absent — and defaulted to the sort key by {@link lwqlGrainColumns} —
   * wherever the two are the same list, which is most of the catalog.
   *
   * Always a subset of the sort key: a grain *wider* than the key the engine
   * collapses on would mean the engine merges rows the dataset considers
   * distinct, which is lost data rather than a duplicate.
   */
  readonly grainColumns?: readonly string[];
  /** Columns another LangWatchQL view can be joined to this one on. */
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
  readonly dedup: LangWatchQLViewDedup;
  readonly columns: readonly LangWatchQLViewColumn[];
}

/**
 * Whether a column carries captured customer content.
 *
 * Reads the column's own gates only. The view generator uses this to decide
 * what a view's SQL must filter out, and a dataset-level gate says who may read
 * the dataset rather than what the values are — a distinction that matters,
 * because a view has no viewer and cannot filter by permission.
 */
export function isContentGated(column: LangWatchQLViewColumn): boolean {
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
 *
 * Bounded rather than "whatever the entry says", because the cast is built by
 * concatenation: a type this does not match — `Nullable(Float64)`, or an
 * aggregate function's own name — would produce `toNullable(Float64)(…)`, which
 * is a provisioning error at best and a differently-typed column at worst.
 */
const SUMMED_COLUMN_TYPE = /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64))$/;

/**
 * The columns identifying one logical row of a dataset.
 *
 * The declared grain where an entry has one, and the source's sort key
 * otherwise — which is the same list wherever the engine collapses on exactly
 * what the dataset calls a row. Read by the fanout diagnostic and by the
 * `in-tuple` view body, so both mean the same thing by construction.
 */
export function lwqlGrainColumns(view: LangWatchQLViewDefinition): readonly string[] {
  return view.grainColumns ?? view.dedup.keyColumns;
}

/**
 * SQL producing a column from the source table.
 *
 * `source` qualifies one of the source table's columns — see
 * {@link LangWatchQLViewColumn.expression} for why every reference must go through
 * it.
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
    throw new Error(
      `lwql catalog: column "${column.name}" declares an empty source column name`,
    );
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
 *
 * Includes the dedup key and version columns even when no exposed column is
 * built from them: without a grant on those the view's own `IN`-tuple cannot be
 * evaluated, and the view fails with an access error rather than a wrong
 * answer — a failure mode that looks like a broken catalog and is really a
 * missing grant. The grain columns need no clause of their own because they are
 * a subset of the key columns, which the unit suite pins.
 */
export function lwqlViewSourceColumns(
  view: LangWatchQLViewDefinition,
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
 *
 * The source tables are deliberately absent: a caller names `analytics.traces`,
 * never the physical table behind it, so the physical names stay out of error
 * messages as well as out of queries.
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
 *
 * Fail-closed on purpose: a permission is withheld unless it is explicitly
 * `true`, so an unresolved `Protections` (the shape `getUserProtectionsForProject`
 * returns when the policy resolver is down) gates everything rather than
 * nothing. Matches how the trace read path reads the same flags.
 */
export function lwqlGatedColumns({
  protections,
  views,
}: {
  protections: Protections;
  views: readonly LangWatchQLViewDefinition[];
}): readonly string[] {
  const held = heldPermissions(protections);
  const withheld = views.flatMap((view) =>
    view.columns
      .filter((column) =>
        lwqlColumnGates({ view, column }).some((gate) => !held.has(gate)),
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
 * {@link lwqlGatedColumns}, so referencing one is refused.
 */
export function lwqlVisibleViews({
  protections,
  views,
}: {
  protections: Protections;
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
      views.flatMap((view) =>
        view.columns.filter(isContentGated).map((column) => column.name),
      ),
    ),
  ].sort();
}
