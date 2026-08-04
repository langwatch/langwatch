/**
 * Governed analytics SQL — what the schema-discovery endpoint publishes.
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
 * `available` is derived from {@link governedGatedColumns} rather than
 * re-deriving the permission mapping, because that function is what the
 * validator's policy is built from: publishing a column as available that the
 * validator would then refuse is the one inconsistency this endpoint must not
 * have, and reusing the derivation is what makes it impossible rather than
 * merely unlikely.
 *
 * @see ./catalog/types.ts — the derivations this projects
 * @see specs/analytics/governed-sql-api.feature
 */

import type { FieldProtection } from "../../traces/projection/catalog";
import type { Protections } from "../../traces/protections";
import { GOVERNED_VIEW_CATALOG } from "./catalog/governedViews";
import {
  type GovernedViewDefinition,
  governedGatedColumns,
} from "./catalog/types";

/** How many columns an example query names. Enough to be a template, not a dump. */
const EXAMPLE_COLUMN_COUNT = 3;

/** How far back an example query looks. A week is a real question, not a toy one. */
const EXAMPLE_LOOKBACK_DAYS = 7;

/** Rows an example query asks for. */
const EXAMPLE_ROW_LIMIT = 100;

/** One column of a governed dataset, as the schema endpoint publishes it. */
export interface GovernedSchemaColumn {
  readonly name: string;
  /** ClickHouse type, exactly what a query gets back. */
  readonly type: string;
  readonly description: string;
  /**
   * Permissions that must *all* be held to reference this column. Empty for an
   * unrestricted column.
   */
  readonly gates: readonly FieldProtection[];
  /** Whether this caller may reference it. `false` names `gates` as the reason. */
  readonly available: boolean;
}

/** One governed dataset, with everything a caller needs to write SQL over it. */
export interface GovernedSchemaDataset {
  /** The name a caller writes, qualified with the governed database. */
  readonly name: string;
  readonly description: string;
  /** What one row is, after deduplication. */
  readonly grain: string;
  /** Columns another governed dataset can be joined to this one on. */
  readonly joinKeys: readonly string[];
  /** Filter on this to prune partitions. */
  readonly timeColumn: string;
  /** How far behind ingestion this dataset can be. */
  readonly freshness: string;
  readonly columns: readonly GovernedSchemaColumn[];
  /** A runnable query over this dataset, naming only unrestricted columns. */
  readonly exampleSql: string;
}

/** The governed schema as one caller sees it. */
export interface GovernedSchema {
  /** Database every dataset name is qualified with. */
  readonly database: string;
  readonly datasets: readonly GovernedSchemaDataset[];
}

/**
 * A runnable query over one dataset.
 *
 * Deliberately built from unrestricted columns only, so the example is valid
 * for every caller regardless of permissions — an example a caller cannot run
 * teaches them the wrong thing about the API. It filters on the dataset's time
 * column because that is the advice the catalog exists to give: without that
 * predicate the read touches every partition the tenant has.
 */
export function governedExampleSql({
  database,
  view,
}: {
  database: string;
  view: GovernedViewDefinition;
}): string {
  const projection = view.columns
    .filter((column) => column.gates.length === 0)
    .slice(0, EXAMPLE_COLUMN_COUNT)
    .map((column) => column.name);
  return (
    `SELECT ${projection.join(", ")}\n` +
    `FROM ${database}.${view.name}\n` +
    `WHERE ${view.timeColumn} >= subtractDays(now(), ${EXAMPLE_LOOKBACK_DAYS})\n` +
    `ORDER BY ${view.timeColumn} DESC\n` +
    `LIMIT ${EXAMPLE_ROW_LIMIT}`
  );
}

/**
 * The governed schema, scoped to what one caller's permissions unlock.
 *
 * Pure: it reads the catalog and the caller's `Protections` and touches nothing
 * else, which is what lets the endpoint publish a schema without a database
 * round trip.
 */
export function describeGovernedSchema({
  database,
  protections,
  views = GOVERNED_VIEW_CATALOG,
}: {
  database: string;
  protections: Protections;
  views?: readonly GovernedViewDefinition[];
}): GovernedSchema {
  const withheld = new Set(governedGatedColumns({ protections, views }));
  return {
    database,
    datasets: views.map((view) => ({
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
        gates: column.gates,
        available: !withheld.has(column.name),
      })),
      exampleSql: governedExampleSql({ database, view }),
    })),
  };
}
