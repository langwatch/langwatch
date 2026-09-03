/**
 * The endpoint's projection of the catalog, not a second schema. Columns stay
 * visible with gate kinds and `available: false`, so a caller can see the
 * permission needed. Datasets with no readable column are absent. Shared
 * catalog derivations keep publication and validator eligibility identical.
 */

import type { LangWatchQLSchema } from "@langwatch/analytics-contract";

import type { Protections } from "@langwatch/trace-server";
import { LWQL_VIEW_CATALOG } from "./catalog/lwql-views";
import {
  type LangWatchQLViewDefinition,
  lwqlColumnGates,
  lwqlGatedColumns,
  lwqlVisibleViews,
} from "./catalog/types";

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

export type {
  LangWatchQLSchema,
  LangWatchQLSchemaColumn,
  LangWatchQLSchemaDataset,
} from "@langwatch/analytics-contract";

/**
 * A runnable query over one dataset.
 *
 * Deliberately built from unrestricted columns only, so the example is valid
 * for every caller regardless of permissions — an example a caller cannot run
 * teaches them the wrong thing about the API. It filters on the dataset's time
 * column because that is the advice the catalog exists to give: without that
 * predicate the read touches every partition the tenant has.
 */
export function lwqlExampleSql({
  database,
  view,
}: {
  database: string;
  view: LangWatchQLViewDefinition;
}): string {
  // The column's own gates, not the combined dataset-plus-column ones: a
  // dataset gated as a whole is only *visible* to a caller who already holds
  // its gates, so its ungated columns are runnable for everyone who can see
  // the example — while the combined set would leave such a dataset with no
  // columns at all and emit `SELECT ` with nothing to select.
  const projection = view.columns
    .filter((column) => column.gates.length === 0)
    .filter((column) => column.name !== EXAMPLE_SKIPPED_COLUMN)
    .slice(0, EXAMPLE_COLUMN_COUNT)
    .map((column) => column.name);
  if (projection.length === 0) {
    // Every column carries its own gate: the one query still runnable by any
    // caller who can see the dataset is a count. No ORDER BY — an aggregate
    // without GROUP BY has nothing to order.
    return (
      `SELECT count() AS rows\n` +
      `FROM ${database}.${view.name}\n` +
      `WHERE ${view.timeColumn} >= subtractDays(now(), ${EXAMPLE_LOOKBACK_DAYS})`
    );
  }
  return (
    `SELECT ${projection.join(", ")}\n` +
    `FROM ${database}.${view.name}\n` +
    `WHERE ${view.timeColumn} >= subtractDays(now(), ${EXAMPLE_LOOKBACK_DAYS})\n` +
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
}: {
  database: string;
  protections: Protections;
  views?: readonly LangWatchQLViewDefinition[];
}): LangWatchQLSchema {
  const withheld = new Set(lwqlGatedColumns({ protections, views }));
  return {
    database,
    datasets: lwqlVisibleViews({ protections, views }).map((view) => ({
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
  };
}
