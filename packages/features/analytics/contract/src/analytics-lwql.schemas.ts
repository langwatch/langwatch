/**
 * The wire shape of one submitted LangWatchQL statement, shared by the
 * workbench's tRPC mutation and `POST /api/v1/query`. The ceiling and the
 * accepted steps ARE the published contract, so both doors read one copy.
 */
import { z } from "zod";

import { lwqlTimeWindowSchema, type LangWatchQLProtections } from "./analytics.lwql.ts";
import { LWQL_GRANULARITY_STEPS } from "./analytics.lwql-time-window.ts";

/**
 * The caller-specific content gates the catalog understands, as a value a
 * transport can carry across a boundary. Annotated with the type it stands for,
 * so the two stop compiling together rather than drifting apart.
 */
export const langWatchQLProtectionsSchema: z.ZodType<LangWatchQLProtections> = z
  .object({
    canSeeCosts: z.boolean().nullable().optional(),
    canSeeCapturedInput: z.boolean().nullable().optional(),
    canSeeCapturedOutput: z.boolean().nullable().optional(),
  })
  .strict();

/**
 * Longest statement any LangWatchQL surface accepts. A shape ceiling rather
 * than a cost one — the cost ceilings are pinned server-side by the settings
 * profile.
 */
export const MAX_LWQL_LENGTH = 50_000;

/**
 * A bound parameter's value. Scalars only: a parameter is a *value*, and
 * anything structured would be one whose shape a declared ClickHouse type
 * cannot describe.
 */
export const lwqlParameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * The datapoint step a caller may request, as every door accepts it — one of
 * the offered {@link LWQL_GRANULARITY_STEPS}, nothing else, so an off-list
 * value is a schema rejection rather than the service's backstop.
 */
export const lwqlGranularityStepSchema = z.union(
  LWQL_GRANULARITY_STEPS.map((step) => z.literal(step)) as [
    z.ZodLiteral<(typeof LWQL_GRANULARITY_STEPS)[number]>,
    z.ZodLiteral<(typeof LWQL_GRANULARITY_STEPS)[number]>,
    ...z.ZodLiteral<(typeof LWQL_GRANULARITY_STEPS)[number]>[],
  ],
);

/** One submitted statement, as both doors accept it. */
export const lwqlStatementSchema = z.object({
  // Deliberately not `.trim()`: the statement the database runs must be the one
  // that was submitted, and normalising it here — however harmlessly — is the
  // first step of the rewriting this API promises never to do.
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: z.record(z.string(), lwqlParameterValueSchema).optional(),
  /**
   * The period this caller is reporting over. Honoured on both doors, because
   * the same saved chart is readable from both and a statement that follows the
   * period must not have two meanings depending on which surface asked.
   */
  timeWindow: lwqlTimeWindowSchema.optional(),
  /**
   * The datapoint step for a statement that declares
   * `{period_granularity_seconds:UInt32}`, in seconds.
   */
  granularitySeconds: lwqlGranularityStepSchema.optional(),
});

export type LangWatchQLStatementRequest = z.infer<typeof lwqlStatementSchema>;
