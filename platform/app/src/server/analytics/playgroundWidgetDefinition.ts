/**
 * What a persisted custom-chart-playground widget's `CustomGraph.graph`
 * column actually stores.
 *
 * One React/TSX file (`code`) plus the named LangWatchQL statements it may
 * run (`queries`) — the file's own `LW.query(name, params)` calls reference a
 * query by `name`. `parameters` on a query is a *declaration*, not bound
 * values: the names and JS types the query accepts, so the parent can check
 * a frame's `params` argument against it before ever forwarding anything to
 * `analytics.lwql.query` as a real bind parameter. The reserved
 * `{period_start}`/`{period_end}`/`{period_granularity_seconds}` placeholders
 * are supplied by the executor regardless of what a query declares here —
 * they are the page window, not an author-declared parameter.
 *
 * Same reasoning as `saved-workbench-charts/workbenchChartDefinition.ts` for
 * being versioned: a `Json` column promises nothing about its contents, so a
 * row is read only through this schema, and a shape written by a
 * disagreeing build is refused by name instead of half-understood.
 *
 * Both the playground router and the client (`CustomChartPlayground.tsx`,
 * which parses `row.graph` with this same schema) import from here, so the
 * two sides cannot drift. Safe for the client to import: this module pulls in
 * nothing but `zod` and a constant, never Prisma or any server-only code.
 */

import { z } from "zod";

import { MAX_LWQL_LENGTH } from "./lwql/sqlText";

/** The version this build writes, and the only one it reads. */
export const PLAYGROUND_WIDGET_DEFINITION_VERSION = 1;

/** A widget file rarely needs more than a couple of named queries. */
const MAX_QUERIES_PER_WIDGET = 8;
/** A query name is referenced from author code as `LW.query("name", ...)`. */
const MAX_QUERY_NAME_LENGTH = 64;
const QUERY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PARAMETERS_PER_QUERY = 32;
/** Generous ceiling for a widget's source file — this is authored code, not data. */
const MAX_CODE_LENGTH = 200_000;

/**
 * The JS types a bound parameter's value may take. Scalars only, matching
 * `analytics.lwql.query`'s own `parameterValueSchema` — a declaration is only
 * useful if it describes something the query endpoint can actually bind.
 */
const queryParameterTypeSchema = z.enum(["string", "number", "boolean"]);

const queryParameterDeclarationSchema = z.object({
  name: z.string().min(1).max(MAX_QUERY_NAME_LENGTH).regex(QUERY_NAME_PATTERN),
  type: queryParameterTypeSchema,
});

export const playgroundQuerySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_QUERY_NAME_LENGTH)
    .regex(
      QUERY_NAME_PATTERN,
      "Query name must look like an identifier (letters, digits, underscore; not starting with a digit)",
    ),
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: z
    .array(queryParameterDeclarationSchema)
    .max(MAX_PARAMETERS_PER_QUERY)
    .optional(),
});

export const playgroundWidgetDefinitionSchema = z.object({
  version: z.literal(PLAYGROUND_WIDGET_DEFINITION_VERSION),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  queries: z.array(playgroundQuerySchema).max(MAX_QUERIES_PER_WIDGET),
});

export type PlaygroundQueryParameterDeclaration = z.infer<
  typeof queryParameterDeclarationSchema
>;
export type PlaygroundQuery = z.infer<typeof playgroundQuerySchema>;
export type PlaygroundWidgetDefinition = z.infer<
  typeof playgroundWidgetDefinitionSchema
>;
