/**
 * What the Instant Evals family accepts: bodies, path parameters and queries.
 *
 * What it answers is next door in `./wire.ts`, which also holds the mapping
 * from the stored row, because the two are one decision: the wire spelling and
 * the function that produces it have to change together.
 *
 * @see ./wire.ts
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { z } from "zod";

import { MAX_LWQL_LENGTH } from "~/server/analytics/lwql";
import {
  INSTANT_EVAL_JUDGMENT_STATUSES,
  INSTANT_EVAL_MAX_ROW_CAP,
  INSTANT_EVAL_RESULTS_CEILING,
  INSTANT_EVAL_SAMPLE_CEILING,
} from "~/server/app-layer/instant-evals/run";

/**
 * A bound parameter's value. Scalars only, the same rule the query family
 * publishes: a parameter is a value, and a structured one has no declared
 * database type to describe it.
 */
const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const instantEvalParametersSchema = z.record(
  z.string(),
  parameterValueSchema,
);

const QUERY_BOOLEAN_SPELLINGS = [
  "true",
  "1",
  "yes",
  "false",
  "0",
  "no",
] as const;
const QUERY_BOOLEAN_TRUE: readonly string[] = ["true", "1", "yes"];

/**
 * A query-string boolean that may also be absent.
 *
 * Spelled as an enumeration rather than coerced: `z.coerce.boolean()` reads the
 * string "false" as true, which would turn a filter into its opposite.
 */
const optionalQueryBoolean = z
  .enum(QUERY_BOOLEAN_SPELLINGS)
  .optional()
  .transform((raw) =>
    raw === undefined ? undefined : QUERY_BOOLEAN_TRUE.includes(raw),
  );

export const instantEvalRunInputSchema = z.object({
  // Never trimmed or rewritten: a run hands the statement back so an agent can
  // copy it, edit it and resubmit, and that only works if it is the one that
  // was submitted.
  sql: z
    .string()
    .min(1)
    .max(MAX_LWQL_LENGTH)
    .describe(
      "The LangWatchQL statement to judge. It must project TraceId and at least one eval function column.",
    ),
  parameters: instantEvalParametersSchema
    .optional()
    .describe("Values for the parameters the statement declares."),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("What to call the run. Yours to choose."),
  limit: z
    .number()
    .int()
    .positive()
    .max(INSTANT_EVAL_MAX_ROW_CAP)
    .optional()
    .describe(
      "Rows the run may judge. Ten thousand by default on every plan, up to one hundred thousand on a plan that lifts the cap.",
    ),
});

export const instantEvalIdParamsSchema = z.object({
  id: z.string().min(1).describe("The run id."),
});

export const instantEvalListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Runs to list, at most one hundred."),
  before: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "List runs accepted strictly before this instant, as an ISO 8601 timestamp. Half of the list's cursor: pass `beforeId` with it.",
    ),
  beforeId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The id of the last run of the previous page. Two runs can share an instant, so this is what keeps a page from skipping the others written in the same millisecond.",
    ),
});

export const instantEvalResultsQuerySchema = z.object({
  questionId: z
    .string()
    .min(1)
    .optional()
    .describe("Only this question's judgements."),
  matched: optionalQueryBoolean.describe(
    "Only judgements that matched, or only those that did not. Omit for both.",
  ),
  status: z
    .enum(INSTANT_EVAL_JUDGMENT_STATUSES)
    .optional()
    .describe("Only judgements in this state."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(INSTANT_EVAL_RESULTS_CEILING)
    .optional()
    .default(100)
    .describe("Judgements per page, at most one thousand."),
  cursor: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("The cursor the previous page answered with."),
});

export const instantEvalSampleQuerySchema = z.object({
  n: z.coerce
    .number()
    .int()
    .min(1)
    .max(INSTANT_EVAL_SAMPLE_CEILING)
    .optional()
    .default(5)
    .describe("Rows to re-read, at most twenty five."),
});

export type InstantEvalRunInputBody = z.infer<typeof instantEvalRunInputSchema>;
export type InstantEvalListQuery = z.infer<typeof instantEvalListQuerySchema>;
export type InstantEvalResultsQuery = z.infer<
  typeof instantEvalResultsQuerySchema
>;
export type InstantEvalSampleQuery = z.infer<
  typeof instantEvalSampleQuerySchema
>;
