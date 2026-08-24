/**
 * What a saved workbench chart actually stores.
 *
 * The record is the pair that travels together — the LangWatchQL that produces
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
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { z } from "zod";

import { MAX_LWQL_LENGTH } from "../lwql/sqlText";

/**
 * The version this build writes, and the only one it reads.
 *
 * Bump it in the same change that alters the shape below, and teach the parser
 * to accept both — a stored row is not migrated by being read.
 */
export const WORKBENCH_CHART_DEFINITION_VERSION = 1;

/**
 * How many parameters one saved chart may bind.
 *
 * A storage ceiling, not a statement about what SQL can express: a query the
 * workbench actually produces binds a handful, and nothing legitimate
 * approaches this. It is here because the alternative is a `Json` column whose
 * size is decided by whatever a caller sends.
 */
const MAX_PARAMETERS = 64;

/**
 * Longest a parameter's name, or its value as text, may be.
 *
 * The name is bound because a parameter is referenced from the SQL as
 * `{name:Type}`, so a real one is identifier-shaped and this is orders of
 * magnitude above any of them. The value is bound because a string scalar is
 * the one variant with no natural size, and an unbounded one turns a chart into
 * a place to keep arbitrary text.
 */
const MAX_PARAMETER_NAME_LENGTH = 256;
const MAX_PARAMETER_VALUE_LENGTH = 4_000;

/**
 * A bound parameter's saved value.
 *
 * Deliberately the scalars and nothing else: the LangWatchQL query endpoint binds
 * named scalars, so admitting an object here would store a chart that could
 * only ever fail when someone opened it.
 */
const parameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  // Finite only: `NaN` and `±Infinity` survive validation but not
  // `JSON.stringify`, so the stored value would be `null` rather than the
  // number that was accepted.
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/**
 * The saved parameter map.
 *
 * The count is checked with an explicit issue rather than a message, so a
 * caller — and a test — reads `too_big` and the maximum instead of parsing
 * prose.
 */
const parametersSchema = z
  .record(z.string().max(MAX_PARAMETER_NAME_LENGTH), parameterValueSchema)
  .superRefine((parameters, ctx) => {
    const count = Object.keys(parameters).length;
    if (count > MAX_PARAMETERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        origin: "object",
        maximum: MAX_PARAMETERS,
        inclusive: true,
      });
    }
  })
  .default({});

export const workbenchChartDefinitionSchema = z.object({
  version: z.literal(WORKBENCH_CHART_DEFINITION_VERSION),
  /**
   * Exactly as the member submitted it. Never rewritten, here or anywhere.
   *
   * Bounded by the same constant the query endpoints bound their input with, so
   * every statement the workbench will run is one it can also save.
   */
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  /** Values for the parameters the SQL declares, keyed by the declared name. */
  parameters: parametersSchema,
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
