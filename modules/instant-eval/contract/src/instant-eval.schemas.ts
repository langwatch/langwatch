/**
 * What the Instant Evals family accepts and what it answers.
 *
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { MAX_LWQL_LENGTH } from "@langwatch/analytics-contract";
import { defineRestMiddleware } from "@langwatch/api/contract";
import type { RestProjectCredentialPrincipal } from "@langwatch/api/rest";
import { z } from "zod";

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_JUDGMENT_STATUSES,
  INSTANT_EVAL_MAX_ROW_CAP,
  INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS,
  INSTANT_EVAL_RESULTS_CEILING,
  INSTANT_EVAL_RUN_STATUSES,
  INSTANT_EVAL_SAMPLE_CEILING,
  INSTANT_EVAL_TARGETS,
} from "./instant-eval-limits.ts";

/** A bound parameter's value: scalars only, as the query family publishes. */
const parameterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const instantEvalParametersSchema = z.record(z.string(), parameterValueSchema);

/**
 * What a stored run reads back: scalars as a caller bound them, plus the one
 * list a run started from the explorer binds its resolved trace ids under.
 */
export const instantEvalStoredParametersSchema = z.record(
  z.string(),
  z.union([parameterValueSchema, z.array(z.string())]),
);

const QUERY_BOOLEAN_SPELLINGS = ["true", "1", "yes", "false", "0", "no"] as const;
const QUERY_BOOLEAN_TRUE: readonly string[] = ["true", "1", "yes"];

/**
 * A query-string boolean that may also be absent. Enumerated rather than
 * coerced: `z.coerce.boolean()` reads "false" as true, which turns a filter
 * into its opposite.
 */
const optionalQueryBoolean = z
  .enum(QUERY_BOOLEAN_SPELLINGS)
  .optional()
  .transform((raw) => (raw === undefined ? undefined : QUERY_BOOLEAN_TRUE.includes(raw)));

/**
 * A string carrying something other than whitespace: `min(1)` alone accepts
 * three spaces, which reach the judge as an empty prompt and are billed.
 */
const written = (schema: z.ZodString) =>
  schema.refine((value) => value.trim().length > 0, {
    message: "Write something other than whitespace.",
  });

/** One named option of a category question. */
export const instantEvalShorthandOptionSchema = z.object({
  name: written(z.string().min(1).max(100)).describe(
    "What the column holds when this option is the answer.",
  ),
  description: written(z.string().min(1).max(500)).describe(
    "What this option means, in your own words.",
  ),
});

export const instantEvalShorthandQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "What to call this question. It becomes the statement's output column and the name every judgement is filed under. Defaults to q1, q2 and so on.",
    ),
  kind: z
    .enum(["boolean", "score", "category"])
    .optional()
    .default("boolean")
    .describe(
      "What kind of answer you want: a yes or no, a rating on a scale, or one of a list of options.",
    ),
  instructions: written(z.string().min(1).max(2_000)).describe(
    "The question, in your own words, as you would write it for a human reader.",
  ),
  criteria: z
    .array(written(z.string().min(1).max(500)))
    .length(2)
    .optional()
    .describe(
      "For a yes or no question: what counts as yes, then what counts as no. Cannot be combined with a threshold.",
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "For a yes or no question: the probability at or above which the answer counts as yes. Without one the column carries the probability itself and a run draws the line at an even chance.",
    ),
  range: z
    .object({
      min: z.number().int().describe("The lowest level of the scale."),
      max: z.number().int().describe("The highest level of the scale."),
    })
    .optional()
    .describe("For a rating: the two ends of the scale."),
  options: z
    .array(instantEvalShorthandOptionSchema)
    .min(2)
    .max(INSTANT_EVAL_CLASSIFIER_LIMITS.maxCategoryOptions)
    .optional()
    .describe("For a choice: the options to pick between."),
});

export type InstantEvalShorthandQuestion = z.infer<typeof instantEvalShorthandQuestionSchema>;

export const instantEvalShorthandSchema = z.object({
  target: z
    .enum(INSTANT_EVAL_TARGETS)
    .describe("What one judged row is: a trace, a conversation, or one model call."),
  filter: z
    .string()
    .max(4_000)
    .optional()
    .describe(
      "A trace filter, in the language the trace explorer's search bar speaks, narrowing which rows are judged.",
    ),
  start: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("The oldest instant to judge, as an ISO 8601 timestamp. Defaults to seven days ago."),
  end: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("The newest instant to judge. Defaults to now."),
  questions: z
    .array(instantEvalShorthandQuestionSchema)
    // Bounded by count here as well as in the column builder, so a list far
    // over the ceiling is refused by its own size rather than by a budget.
    .min(1)
    .max(INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS)
    .describe("What to ask of each row. One classification asks them all."),
});

export type InstantEvalShorthandInput = z.infer<typeof instantEvalShorthandSchema>;

export const instantEvalRunInputSchema = z.object({
  // Never trimmed or rewritten: a run hands the statement back so an agent can
  // copy it, edit it and resubmit, which only works if it is the one sent.
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
      "With target: what to ask of each row. One classification asks them all per row, and the question text is part of what that classification is priced on; the estimate endpoint prices the exact set.",
    ),
  name: z.string().min(1).max(200).optional().describe("What to call the run. Yours to choose."),
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

export type InstantEvalRunInputBody = z.infer<typeof instantEvalRunInputSchema>;

/** A cancel takes no body: the run travels in the path. */
export const cancelInstantEvalRunBodySchema = z.object({});

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
  // The two halves are one cursor: half of it pages from an instant with no
  // tie-break or from an id with no anchor, and either skips rows silently.
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
  questionId: z.string().min(1).optional().describe("Only this question's judgements."),
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

export type InstantEvalListQuery = z.infer<typeof instantEvalListQuerySchema>;
export type InstantEvalResultsQuery = z.infer<typeof instantEvalResultsQuerySchema>;
export type InstantEvalSampleQuery = z.infer<typeof instantEvalSampleQuerySchema>;

const instantEvalRunQuestionSchema = z.object({
  id: z
    .string()
    .describe(
      "The statement's own output column, which is the name this question is addressed by everywhere else.",
    ),
  function: z.string().describe("The eval function that asked it."),
  kind: z
    .enum(["boolean", "score", "category"])
    .describe("What kind of answer the question takes."),
  reads: z.string().describe("Which part of the verdict the statement's column carries."),
  threshold: z
    .number()
    .nullable()
    .describe(
      "Where a boolean question's probability becomes a pass. Null for a question that is not a boolean.",
    ),
});

export type InstantEvalRunQuestionWire = z.infer<typeof instantEvalRunQuestionSchema>;

export const instantEvalRunSchema = z.object({
  id: z.string().describe("The run id."),
  name: z.string().nullable().describe("What the run was called, if anything."),
  sql: z.string().describe("The statement, exactly as submitted."),
  parameters: instantEvalStoredParametersSchema.describe(
    "The values the statement's parameters were filled with.",
  ),
  questions: z
    .array(instantEvalRunQuestionSchema)
    .describe(
      "One entry per eval function the statement projects, derived from it when the run was accepted.",
    ),
  limit: z.number().int().describe("Rows this run may judge."),
  status: z.enum(INSTANT_EVAL_RUN_STATUSES).describe("Where the run is in its life."),
  total: z
    .number()
    .int()
    .nullable()
    .describe("Rows the run found, bounded by its limit. Null until it has looked."),
  progress: z.number().int().describe("Rows judged so far."),
  matched: z
    .number()
    .int()
    .nullable()
    .describe(
      "Judgements that matched, across this run's boolean questions. Null when the run asked none: a score or a category question has no match to count.",
    ),
  matchedByQuestion: z
    .record(z.string(), z.number())
    .describe(
      "Per question: matches for a boolean question, judged rows for a score or a category one.",
    ),
  failed: z.number().int().describe("Rows the judge could not answer."),
  skipped: z.number().int().describe("Rows the judge declined to answer."),
  tokens: z.number().int().describe("Input tokens the judge billed for."),
  priceUsd: z.number().describe("What the judging costs you, in United States dollars."),
  error: z
    .string()
    .nullable()
    .describe("The code of the failure that ended the run, when one did."),
  createdAt: z.string().describe("When the run was accepted."),
  updatedAt: z.string().describe("When the run was last written to."),
  startedAt: z.string().nullable().describe("When the run began reading rows."),
  finishedAt: z.string().nullable().describe("When the run ended."),
});

export const instantEvalEstimateSchema = z.object({
  rows: z.number().int().describe("Rows the statement matches, bounded by the run's limit."),
  isRowsCapped: z
    .boolean()
    .describe("Whether the statement matches more rows than the run may judge."),
  avgTokens: z
    .number()
    .int()
    .describe("Input tokens one judged row sends, measured from a sample."),
  totalTokens: z.number().int().describe("Input tokens the whole run would send."),
  requests: z.number().int().describe("Classifications the run would make, one per judged row."),
  priceUsd: z.number().describe("What the run would cost you, in United States dollars."),
  freeBudgetRemainingUsd: z
    .number()
    .optional()
    .describe(
      "What is left of the free Instant Evals budget, in United States dollars. Only present for an organization without a paid plan.",
    ),
});

export const instantEvalJudgmentSchema = z.object({
  traceId: z.string().describe("The trace the judgement is about."),
  questionId: z.string().describe("The question it answers, named by its output column."),
  threadId: z.string().describe("The conversation the trace belongs to."),
  spanId: z.string().describe("The span the judged text was read from."),
  kind: z.string().describe("What kind of question was asked."),
  status: z
    .enum(INSTANT_EVAL_JUDGMENT_STATUSES)
    .describe("Whether the judge answered, declined, or could not answer."),
  passed: z.boolean().nullable().describe("Whether a boolean question passed its threshold."),
  score: z.number().nullable().describe("A score question's answer."),
  label: z.string().nullable().describe("A category question's answer."),
  probability: z
    .number()
    .nullable()
    .describe("How likely the judge found a boolean question's answer to be true."),
  probabilities: z
    .record(z.string(), z.number())
    .nullable()
    .describe("The full distribution behind a category answer."),
  error: z.string().nullable().describe("Why the judge could not answer, when it could not."),
  occurredAt: z.string().describe("When the judgement was made."),
});

export const instantEvalRunListSchema = z.object({
  runs: z.array(instantEvalRunSchema).describe("The project's runs, newest first."),
});

export const instantEvalResultsSchema = z.object({
  judgments: z.array(instantEvalJudgmentSchema).describe("One page of the run's judgements."),
  nextCursor: z
    .string()
    .optional()
    .describe("Pass as cursor to read the page after this one. Absent on the last page."),
});

export const instantEvalSampleSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.any()))
    .describe(
      "The statement's own rows, with each judged column holding the text that was judged rather than the verdict.",
    ),
  judgments: z.array(instantEvalJudgmentSchema).describe("The verdicts those rows received."),
});

export type InstantEvalRunWire = z.infer<typeof instantEvalRunSchema>;
export type InstantEvalJudgmentWire = z.infer<typeof instantEvalJudgmentSchema>;
export type InstantEvalEstimateWire = z.infer<typeof instantEvalEstimateSchema>;
export type InstantEvalResultsWire = z.infer<typeof instantEvalResultsSchema>;
export type InstantEvalSampleWire = z.infer<typeof instantEvalSampleSchema>;

/**
 * The credential a request arrived on. A run reads its rows as the asker's own
 * cut of the project's content, and over REST the asker is a KEY: the door's
 * to resolve, never a handler's to reach for.
 */
export const instantEvalRestCredentialSchema: z.ZodType<RestProjectCredentialPrincipal> =
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("apiKey"),
      apiKeyId: z.string(),
      userId: z.string().nullable(),
      organizationId: z.string(),
      projectId: z.string(),
      teamId: z.string(),
      isLangySessionKey: z.boolean().optional(),
    }),
    z.object({ kind: z.literal("legacyProjectKey") }),
  ]);

export const instantEvalRestCredential = defineRestMiddleware(
  "instantEvalRestCredential",
  instantEvalRestCredentialSchema,
);
