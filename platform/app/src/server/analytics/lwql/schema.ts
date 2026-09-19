/**
 * LangWatchQL analytics SQL — what the schema-discovery endpoint publishes.
 *
 * A projection of `./catalog/`, never a second description of it. Every field
 * here is read off a catalog entry or derived from one, so a column added to
 * the catalog appears in the published schema with no edit in this file, and a
 * column removed from it disappears.
 *
 * ## Gates are published as kinds, not as a boolean
 *
 * A column withheld from a caller says *which* permission would unlock it —
 * `input`, `output` or `costs` — rather than collapsing to "you cannot have
 * this". The consumer of this API is usually an agent writing SQL with no UI to
 * fall back on, and the two answers lead somewhere different: a boolean tells
 * it to give up, while the gate kind tells it (or the human reading its output)
 * exactly which permission to ask for. Withheld columns therefore stay *listed*,
 * carrying `available: false` — omitting them would hide the very fact that
 * makes the refusal actionable, and would also make the schema silently
 * disagree with the validator, which refuses a gated name whether or not the
 * caller was told it exists.
 *
 * `available` is derived from {@link lwqlGatedColumns} rather than
 * re-deriving the permission mapping, because that function is what the
 * validator's policy is built from: publishing a column as available that the
 * validator would then refuse is the one inconsistency this endpoint must not
 * have, and reusing the derivation is what makes it impossible rather than
 * merely unlikely.
 *
 * ## A view the caller can read nothing in is absent, not empty
 *
 * A column stays listed because naming its gate is what makes the refusal
 * actionable. A *view* with nothing readable in it has no such half-answer
 * to give — every column would carry the same refusal, and the list would be a
 * page of them. {@link lwqlVisibleViews} decides, and the validator agrees
 * without a second arrangement: every column of an absent view is withheld,
 * so referencing one is refused.
 *
 * @see ./catalog/types.ts — the derivations this projects
 * @see specs/lwql/api.feature
 */

import type { FieldProtection } from "../../traces/projection/catalog";
import type { Protections } from "../../traces/protections";
import {
  type LangWatchQLAppFunctionDefinition,
  type LangWatchQLAppFunctionEncoding,
  type LangWatchQLAppFunctionKeyKind,
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionCap,
  lwqlAppFunctionSignature,
} from "./appFunctions/catalog";
import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import {
  type LangWatchQLColumnUnit,
  type LangWatchQLViewDefinition,
  lwqlColumnGates,
  lwqlGatedColumns,
  lwqlHeldPermissions,
  lwqlVisibleViews,
} from "./catalog/types";
import { LWQL_ALLOWED_FUNCTION_NAMES } from "./validation/functions";

/** How many columns an example query names. Enough to be a template, not a dump. */
const EXAMPLE_COLUMN_COUNT = 3;

/**
 * Never in an example's projection: the server pins every query to one tenant,
 * so this column holds a single repeated value and selecting it teaches
 * nothing. It stays published and selectable — only the example skips it.
 */
const EXAMPLE_SKIPPED_COLUMN = "TenantId";

/** How far back an example query looks. A week is a real question, not a toy one. */
const EXAMPLE_LOOKBACK_DAYS = 7;

/** Rows an example query asks for. */
const EXAMPLE_ROW_LIMIT = 100;

/**
 * A `timeColumn` whose declared type this matches is temporal or numeric —
 * comparable to `subtractDays(now(), …)` — and can bound a lookback. A view
 * whose time column is an opaque key (e.g. a String id used only to order,
 * because the model has no `CreatedAt` and no `DateTime64` column) fails
 * this match, and the example must not compare it to a date.
 */
export const BOUNDABLE_TIME_COLUMN_TYPE = /Date|Int|Float|Decimal/;

/**
 * The `WHERE <timeColumn> >= subtractDays(...)` clause for an example query,
 * or `null` when the view's time column cannot be bounded that way.
 *
 * The predicate is advice for partitioned sources: filter on the time column
 * to prune partitions. A view whose time column is an opaque key (a String
 * used only to order rows, not a date) has nothing to bound — comparing it to
 * a date is a ClickHouse type error, not a lookback.
 */
export function exampleLookbackPredicate({
  view,
}: {
  view: LangWatchQLViewDefinition;
}): string | null {
  const timeColumnType = view.columns.find(
    (column) => column.name === view.timeColumn,
  )?.type;
  if (!timeColumnType || !BOUNDABLE_TIME_COLUMN_TYPE.test(timeColumnType)) {
    return null;
  }
  return `WHERE ${view.timeColumn} >= subtractDays(now(), ${EXAMPLE_LOOKBACK_DAYS})`;
}

/** One column of a LangWatchQL view, as the schema endpoint publishes it. */
export interface LangWatchQLSchemaColumn {
  readonly name: string;
  /** ClickHouse type, exactly what a query gets back. */
  readonly type: string;
  readonly description: string;
  /**
   * What the values are measured in, or `null` when they are not measured in
   * anything — an identifier, a name, a flag, a count or a score.
   *
   * Explicitly `null` rather than absent, so a consumer can tell "this column
   * has no unit" from "this API is older than units".
   */
  readonly unit: LangWatchQLColumnUnit | null;
  /**
   * Permissions that must *all* be held to reference this column. Empty for an
   * unrestricted column.
   */
  readonly gates: readonly FieldProtection[];
  /** Whether this caller may reference it. `false` names `gates` as the reason. */
  readonly available: boolean;
}

/** One LangWatchQL view, with everything a caller needs to write SQL over it. */
export interface LangWatchQLSchemaView {
  /** The name a caller writes, qualified with the LangWatchQL database. */
  readonly name: string;
  readonly description: string;
  /** What one row is, after deduplication. */
  readonly grain: string;
  /** Columns another LangWatchQL view can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /** Filter on this to prune partitions. */
  readonly timeColumn: string;
  /** How far behind ingestion this view can be. */
  readonly freshness: string;
  readonly columns: readonly LangWatchQLSchemaColumn[];
  /** A runnable query over this view, naming only unrestricted columns. */
  readonly exampleSql: string;
}

/**
 * One app function, as the schema endpoint publishes it.
 *
 * Published for the same reason the columns are, and with the same rule: a
 * function this caller cannot use stays *listed*, carrying `available: false`
 * and its gates, because the gate kind is what makes the refusal actionable to
 * an agent with no UI to fall back on.
 */
export interface LangWatchQLSchemaAppFunction {
  readonly name: string;
  /** `conversation_bounded(thread_key, max_tokens, until_trace_id)`. */
  readonly signature: string;
  readonly description: string;
  /** ClickHouse type of the hydrated column, which the result re-declares. */
  readonly returns: string;
  /**
   * How to read the returned string: `json` for a payload a consumer should
   * parse back, `text` for prose.
   */
  readonly encoding: LangWatchQLAppFunctionEncoding;
  /** What the first argument names, which is what the cap counts. */
  readonly keyKind: LangWatchQLAppFunctionKeyKind;
  /**
   * Whether the value is read from a trace or judged by a model.
   *
   * Published because the two cost different things: an extraction function is
   * a read, and an eval function is a metered classification per row.
   */
  readonly kind: "extraction" | "eval";
  /** How many distinct keys of that kind one run may read. */
  readonly cap: number;
  /** Permissions that must *all* be held to call it. Empty for an ungated one. */
  readonly gates: readonly FieldProtection[];
  readonly available: boolean;
  /** A runnable query, naming only columns every caller can select. */
  readonly exampleSql: string;
}

/** The LangWatchQL schema as one caller sees it. */
export interface LangWatchQLSchema {
  /** Database every view name is qualified with. */
  readonly database: string;
  readonly views: readonly LangWatchQLSchemaView[];
  /**
   * Every function name a query may call. Permission-independent — the
   * functions a query may call do not vary by what a key can see — and equal to
   * the validator's own allowlist, so what the schema publishes and what the
   * validator enforces cannot drift.
   */
  readonly functions: readonly string[];
  /**
   * The app functions a projection may call.
   *
   * A section rather than columns on a view: a function is not a property of
   * one view — `llm_readable_trace` reads a trace id from wherever the caller
   * found one — and listing it under each would publish the same entry five
   * times. Separate from `functions` because these are not ClickHouse
   * functions: they are resolved by the app after the query runs, and each
   * carries its own gates, cap and encoding.
   */
  readonly appFunctions: readonly LangWatchQLSchemaAppFunction[];
}

/**
 * A runnable query over one view.
 *
 * Deliberately built from unrestricted columns only, so the example is valid
 * for every caller regardless of permissions — an example a caller cannot run
 * teaches them the wrong thing about the API. When the view's time column is
 * temporal or numeric ({@link exampleLookbackPredicate}), it filters on that
 * column, because that is the advice the catalog exists to give: without that
 * predicate the read touches every partition the tenant has. A view whose
 * time column is an opaque key (a derived model with no `CreatedAt` and no
 * `DateTime64` column) has nothing to bound, so the example orders by it
 * instead of comparing it to a date.
 */
export function lwqlExampleSql({
  database,
  view,
}: {
  database: string;
  view: LangWatchQLViewDefinition;
}): string {
  // The column's own gates, not the combined view-plus-column ones: a
  // view gated as a whole is only *visible* to a caller who already holds
  // its gates, so its ungated columns are runnable for everyone who can see
  // the example — while the combined set would leave such a view with no
  // columns at all and emit `SELECT ` with nothing to select.
  const projection = view.columns
    .filter((column) => column.gates.length === 0)
    .filter((column) => column.name !== EXAMPLE_SKIPPED_COLUMN)
    .slice(0, EXAMPLE_COLUMN_COUNT)
    .map((column) => column.name);
  const lookback = exampleLookbackPredicate({ view });
  if (projection.length === 0) {
    // Every column carries its own gate: the one query still runnable by any
    // caller who can see the view is a count. No ORDER BY — an aggregate
    // without GROUP BY has nothing to order.
    return lookback
      ? `SELECT count() AS rows\n` +
          `FROM ${database}.${view.name}\n` +
          `${lookback}`
      : `SELECT count() AS rows\nFROM ${database}.${view.name}`;
  }
  if (!lookback) {
    return (
      `SELECT ${projection.join(", ")}\n` +
      `FROM ${database}.${view.name}\n` +
      `ORDER BY ${view.timeColumn} DESC\n` +
      `LIMIT ${EXAMPLE_ROW_LIMIT}`
    );
  }
  return (
    `SELECT ${projection.join(", ")}\n` +
    `FROM ${database}.${view.name}\n` +
    `${lookback}\n` +
    `ORDER BY ${view.timeColumn} DESC\n` +
    `LIMIT ${EXAMPLE_ROW_LIMIT}`
  );
}

/**
 * The LangWatchQL schema, scoped to what one caller's permissions unlock.
 *
 * Pure: it reads the catalog and the caller's `Protections` and touches nothing
 * else, which is what lets the endpoint publish a schema without a database
 * round trip.
 */
export function describeLangWatchQLSchema({
  database,
  protections,
  views = LWQL_VIEW_CATALOG,
  appFunctions = LWQL_APP_FUNCTION_CATALOG,
  instantEvalsEnabled = false,
}: {
  database: string;
  protections: Protections;
  views?: readonly LangWatchQLViewDefinition[];
  appFunctions?: readonly LangWatchQLAppFunctionDefinition[];
  /** Whether this project may call an eval function. Off unless it is asked. */
  instantEvalsEnabled?: boolean;
}): LangWatchQLSchema {
  const withheld = new Set(lwqlGatedColumns({ protections, views }));
  return {
    database,
    functions: LWQL_ALLOWED_FUNCTION_NAMES,
    views: lwqlVisibleViews({ protections, views }).map((view) => ({
      name: `${database}.${view.name}`,
      description: view.description,
      grain: view.grain,
      joinKeys: view.joinKeys,
      timeColumn: view.timeColumn,
      freshness: view.freshness,
      columns: view.columns.map((column) => ({
        name: column.name,
        type: column.type,
        description: column.description,
        unit: column.unit ?? null,
        gates: lwqlColumnGates({ view, column }),
        available: !withheld.has(column.name),
      })),
      exampleSql: lwqlExampleSql({ database, view }),
    })),
    // Last, so every field a consumer already read keeps the position it had.
    appFunctions: describeLangWatchQLAppFunctions({
      database,
      protections,
      appFunctions,
      instantEvalsEnabled,
    }),
  };
}

/**
 * The app functions, scoped to what this caller's permissions unlock.
 *
 * `available` is derived from the same held-permission set the validator's
 * policy is built from, so the endpoint cannot publish a function as available
 * that the validator would then refuse — the one inconsistency this section
 * must not have.
 */
export function describeLangWatchQLAppFunctions({
  database,
  protections,
  appFunctions = LWQL_APP_FUNCTION_CATALOG,
  instantEvalsEnabled = false,
}: {
  database: string;
  protections: Protections;
  appFunctions?: readonly LangWatchQLAppFunctionDefinition[];
  /** Whether this project may call an eval function. Off unless it is asked. */
  instantEvalsEnabled?: boolean;
}): readonly LangWatchQLSchemaAppFunction[] {
  const held = lwqlHeldPermissions(protections);
  return appFunctions.map((definition) => ({
    name: definition.name,
    kind: definition.kind,
    signature: lwqlAppFunctionSignature(definition),
    description: definition.description,
    returns: definition.returns,
    encoding: definition.encoding,
    keyKind: definition.keyKind,
    cap: lwqlAppFunctionCap(definition),
    gates: definition.gates,
    // Two conditions for an eval function, and both are about whether the call
    // would work: the caller's permissions, and whether this project may judge
    // at all. Publishing one as available where nothing can answer it puts a
    // caller in front of a query that always comes back null.
    available:
      definition.gates.every((gate) => held.has(gate)) &&
      (definition.kind !== "eval" || instantEvalsEnabled),
    exampleSql: definition.example(database),
  }));
}
