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
import {
  INSTANT_EVAL_TARGETS,
  instantEvalShorthandQuestionSchema,
} from "~/server/app-layer/instant-evals/shorthand";

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
    .optional()
    .describe(
      "The LangWatchQL statement to judge. It must project TraceId and at least one eval function column. Send this or target, never both.",
    ),
  parameters: instantEvalParametersSchema
    .optional()
    .describe("Values for the parameters the statement declares."),
  target: z
    .enum(INSTANT_EVAL_TARGETS)
    .optional()
    .describe(
      "What one judged row is, in place of a statement: a trace, a conversation, or one model call. The statement is written for you from this and the questions, and handed back on the run so you can edit it and resubmit.",
    ),
  filter: z
    .string()
    .max(4_000)
    .optional()
    .describe(
      "With target: a trace filter, in the language the trace explorer's search bar speaks, narrowing which rows are judged.",
    ),
  start: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "With target: the oldest instant to judge, as an ISO 8601 timestamp. Defaults to seven days ago.",
    ),
  end: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("With target: the newest instant to judge. Defaults to now."),
  questions: z
    .array(instantEvalShorthandQuestionSchema)
    .optional()
    .describe(
      "With target: what to ask of each row. One classification asks them all, which is why a three-question run costs about what a one-question run does.",
    ),
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

export const instantEvalListQuerySchema = z
  .object({
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
  })
  // The two halves are one cursor. Half a cursor would page from an instant
  // with no tie-break, or from an id with no instant to anchor it, and either
  // way the page would skip or repeat rows without saying so.
  .superRefine((query, ctx) => {
    if ((query.before === undefined) === (query.beforeId === undefined)) return;
    const missing = query.before === undefined ? "before" : "beforeId";
    const given = missing === "before" ? "beforeId" : "before";
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [missing],
      message: `${missing} is required when ${given} is given: the two together are the list's cursor.`,
    });
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

/**
 * Whichever of these keys the body actually carried.
 *
 * Absent rather than `undefined`, because the service's own input type is
 * exact: a key present and holding `undefined` is not the same as a key the
 * caller left out, and the second is what a body without it means.
 */
function present<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The shorthand half of the body, or nothing when no target was named. */
function shorthandOf(body: InstantEvalRunInputBody) {
  if (body.target === undefined) return {};
  return {
    shorthand: {
      target: body.target,
      questions: body.questions ?? [],
      ...present({
        filter: body.filter,
        start: body.start,
        end: body.end,
      }),
    },
  };
}

/**
 * The body as the service takes it: a statement, or a shorthand under one key.
 *
 * The wire is flat because that is what a caller writes on a command line and
 * in a JSON body; the service takes the shorthand as one object because a
 * target with no questions is not a shorthand. Held together here rather than
 * in the routes, so both the create and the estimate route read one line.
 */
export function toInstantEvalRunInput(body: InstantEvalRunInputBody) {
  return {
    ...present({
      sql: body.sql,
      parameters: body.parameters,
      name: body.name,
      limit: body.limit,
    }),
    ...shorthandOf(body),
  };
}
