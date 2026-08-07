/**
 * What a saved workbench chart actually stores.
 *
 * The record is the pair that travels together — the governed SQL that produces
 * the numbers and the Vega-Lite specification that draws them — plus the
 * parameter values the SQL was saved with. They are stored side by side rather
 * than folded into each other: no visualization syntax reaches the SQL, and the
 * specification never learns to query.
 *
 * The shape is versioned because it lives in a `Json` column, which promises
 * nothing about what is inside it. A row is only ever read through this schema,
 * so a definition written by a build that disagreed with this one is refused by
 * name instead of being half-understood.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { z } from "zod";

/**
 * The `CustomGraph.kind` value a saved workbench chart carries.
 *
 * The discriminator is what lets the chart builder and the workbench share one
 * table: each reads only its own kind, so a builder payload is never handed to
 * the parser below and a workbench definition never reaches the builder.
 */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/** The `CustomGraph.kind` every row written before the discriminator carries. */
export const BUILDER_CHART_KIND = "builder";

/**
 * The version this build writes, and the only one it reads.
 *
 * Bump it in the same change that alters the shape below, and teach the parser
 * to accept both — a stored row is not migrated by being read.
 */
export const WORKBENCH_CHART_DEFINITION_VERSION = 1;

/**
 * A bound parameter's saved value.
 *
 * Deliberately the scalars and nothing else: the governed query endpoint binds
 * named scalars, so admitting an object here would store a chart that could
 * only ever fail when someone opened it.
 */
const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const workbenchChartDefinitionSchema = z.object({
  version: z.literal(WORKBENCH_CHART_DEFINITION_VERSION),
  /** Exactly as the member submitted it. Never rewritten, here or anywhere. */
  sql: z.string().min(1),
  /** Values for the parameters the SQL declares, keyed by the declared name. */
  parameters: z.record(z.string(), parameterValueSchema).default({}),
  /**
   * The specification that renders the result, when the member authored one.
   *
   * Optional because a query saved without a chart is the same record: the
   * workbench derives a starter specification from the result shape, so a
   * definition with no specification means "derive one on open" rather than
   * "this is not a chart". Absent is the only way to say that — there is no
   * second null-ish spelling to disagree with.
   */
  vegaLiteSpec: z.record(z.string(), z.unknown()).optional(),
});

export type WorkbenchChartDefinition = z.infer<
  typeof workbenchChartDefinitionSchema
>;
