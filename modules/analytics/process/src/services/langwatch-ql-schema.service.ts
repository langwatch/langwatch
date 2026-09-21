/**
 * The endpoint's projection of the catalog, not a second schema. Columns
 * stay visible with gate kinds and `available: false`, so a caller can see
 * the permission needed; datasets with no readable column are absent.
 */

import type {
  LangWatchQLProtections,
  LangWatchQLSchema,
  LangWatchQLSchemaAppFunction,
} from "@langwatch/analytics-contract";

import {
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionCap,
  lwqlAppFunctionSignature,
} from "../rules/langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "../rules/langwatch-ql-app-function-shapes.rules.ts";
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";

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

const catalogShapes = LangWatchQLCatalogShapesService.create();

/** The endpoint's projection of the LangWatchQL catalog for one caller. */
export class LangWatchQLSchemaService {
  static create(): LangWatchQLSchemaService {
    return new LangWatchQLSchemaService();
  }

  private constructor() {}

  /**
   * A runnable query over one dataset.
   */
  exampleSql({ database, view }: { database: string; view: LangWatchQLViewDefinition }): string {
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
   * The app functions, scoped to what this caller's permissions unlock, from
   * the same held-permission set the validator's policy is built from — so the
   * endpoint cannot publish one as available that the validator would refuse.
   */
  describeAppFunctions({
    database,
    protections,
    appFunctions = LWQL_APP_FUNCTION_CATALOG,
    isInstantEvalsEnabled = false,
  }: {
    database: string;
    protections: LangWatchQLProtections;
    appFunctions?: readonly LangWatchQLAppFunctionDefinition[];
    /** Whether this project may call an eval function. Off unless it is asked. */
    isInstantEvalsEnabled?: boolean;
  }): readonly LangWatchQLSchemaAppFunction[] {
    const held = catalogShapes.heldPermissions(protections);

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
      // Two conditions for an eval function, both about whether the call would
      // work: the caller's permissions, and whether this project may judge at
      // all. Publishing one as available where nothing can answer it puts a
      // caller in front of a query that always comes back null.
      available:
        definition.gates.every((gate) => held.has(gate)) &&
        (definition.kind !== "eval" || isInstantEvalsEnabled),
      exampleSql: definition.example(database),
    }));
  }

  /** The LangWatchQL schema, scoped to what one caller's permissions unlock. */
  describe({
    database,
    protections,
    views = LWQL_VIEW_CATALOG,
    isInstantEvalsEnabled = false,
  }: {
    database: string;
    protections: LangWatchQLProtections;
    views?: readonly LangWatchQLViewDefinition[];
    isInstantEvalsEnabled?: boolean;
  }): LangWatchQLSchema {
    const withheld = new Set(catalogShapes.gatedColumns({ protections, views }));

    return {
      database,
      datasets: catalogShapes.visibleViews({ protections, views }).map((view) => ({
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
          gates: catalogShapes.columnGates({ view, column }),
          available: !withheld.has(column.name),
        })),
        exampleSql: this.exampleSql({ database, view }),
      })),
      appFunctions: this.describeAppFunctions({ database, protections, isInstantEvalsEnabled }),
    };
  }
}
