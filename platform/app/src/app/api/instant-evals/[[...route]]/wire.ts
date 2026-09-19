/**
 * What the Instant Evals family answers, and how the stored row becomes it.
 *
 * The wire shape is deliberately not the stored row. Three columns never
 * reach a caller in their stored spelling: `status` is published lowercase
 * because that is what every other v1 family publishes, `rowLimit` is
 * published as `limit` because that is the word the request uses, and the
 * hydration plan is not published at all. It is meaningful only to the
 * pipeline, and a caller reading it would be reading how the feature is built
 * rather than what their run did.
 *
 * @see ./schemas.ts
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { z } from "zod";

import {
  INSTANT_EVAL_JUDGMENT_STATUSES,
  type InstantEvalJudgment,
} from "~/server/app-layer/instant-evals/run";
import type { InstantEvalRunRow } from "~/server/app-layer/instant-evals/run/instant-eval-run.repository";
import { readInstantEvalRunQuestions } from "~/server/app-layer/instant-evals/run/questions";
import type { InstantEvalRunProjectedStatus } from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import { instantEvalParametersSchema } from "./schemas";

/** The statuses a run reports, lowercase. */
const INSTANT_EVAL_RUN_WIRE_STATUSES = [
  "queued",
  "planning",
  "running",
  "finished",
  "failed",
  "cancelled",
] as const;

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
  reads: z
    .string()
    .describe("Which part of the verdict the statement's column carries."),
  threshold: z
    .number()
    .nullable()
    .describe(
      "Where a boolean question's probability becomes a pass. Null for a question that is not a boolean.",
    ),
});

export const instantEvalRunSchema = z.object({
  id: z.string().describe("The run id."),
  name: z.string().nullable().describe("What the run was called, if anything."),
  sql: z.string().describe("The statement, exactly as submitted."),
  parameters: instantEvalParametersSchema.describe(
    "The values the statement's parameters were filled with.",
  ),
  questions: z
    .array(instantEvalRunQuestionSchema)
    .describe(
      "One entry per eval function the statement projects, derived from it when the run was accepted.",
    ),
  limit: z.number().int().describe("Rows this run may judge."),
  status: z
    .enum(INSTANT_EVAL_RUN_WIRE_STATUSES)
    .describe("Where the run is in its life."),
  total: z
    .number()
    .int()
    .nullable()
    .describe(
      "Rows the run found, bounded by its limit. Null until it has looked.",
    ),
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
  costUsd: z
    .number()
    .describe("What the judging cost us, in United States dollars."),
  priceUsd: z
    .number()
    .describe("What the judging costs you, in United States dollars."),
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
  rows: z
    .number()
    .int()
    .describe("Rows the statement matches, bounded by the run's limit."),
  isRowsCapped: z
    .boolean()
    .describe(
      "Whether the statement matches more rows than the run may judge.",
    ),
  avgTokens: z
    .number()
    .int()
    .describe("Input tokens one judged row sends, measured from a sample."),
  totalTokens: z
    .number()
    .int()
    .describe("Input tokens the whole run would send."),
  requests: z
    .number()
    .int()
    .describe("Classifications the run would make, one per judged row."),
  costUsd: z
    .number()
    .describe("What the run would cost us, in United States dollars."),
  priceUsd: z
    .number()
    .describe("What the run would cost you, in United States dollars."),
  freeBudgetRemainingUsd: z
    .number()
    .optional()
    .describe(
      "What is left of the free Instant Evals budget, in United States dollars. Only present for an organization without a paid plan.",
    ),
});

export const instantEvalJudgmentSchema = z.object({
  traceId: z.string().describe("The trace the judgement is about."),
  questionId: z
    .string()
    .describe("The question it answers, named by its output column."),
  threadId: z.string().describe("The conversation the trace belongs to."),
  spanId: z.string().describe("The span the judged text was read from."),
  kind: z.string().describe("What kind of question was asked."),
  status: z
    .enum(INSTANT_EVAL_JUDGMENT_STATUSES)
    .describe("Whether the judge answered, declined, or could not answer."),
  passed: z
    .boolean()
    .nullable()
    .describe("Whether a boolean question passed its threshold."),
  score: z.number().nullable().describe("A score question's answer."),
  label: z.string().nullable().describe("A category question's answer."),
  probability: z
    .number()
    .nullable()
    .describe(
      "How likely the judge found a boolean question's answer to be true.",
    ),
  probabilities: z
    .record(z.string(), z.number())
    .nullable()
    .describe("The full distribution behind a category answer."),
  error: z
    .string()
    .nullable()
    .describe("Why the judge could not answer, when it could not."),
  occurredAt: z.string().describe("When the judgement was made."),
});

export const instantEvalRunListSchema = z.object({
  runs: z
    .array(instantEvalRunSchema)
    .describe("The project's runs, newest first."),
});

export const instantEvalResultsSchema = z.object({
  judgments: z
    .array(instantEvalJudgmentSchema)
    .describe("One page of the run's judgements."),
  nextCursor: z
    .string()
    .optional()
    .describe(
      "Pass as cursor to read the page after this one. Absent on the last page.",
    ),
});

export const instantEvalSampleSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.any()))
    .describe(
      "The statement's own rows, with each judged column holding the text that was judged rather than the verdict.",
    ),
  judgments: z
    .array(instantEvalJudgmentSchema)
    .describe("The verdicts those rows received."),
});

export type InstantEvalRunWire = z.infer<typeof instantEvalRunSchema>;
export type InstantEvalJudgmentWire = z.infer<typeof instantEvalJudgmentSchema>;

/** The lowercase status each stored one publishes as. */
const RUN_WIRE_STATUS = {
  QUEUED: "queued",
  PLANNING: "planning",
  RUNNING: "running",
  FINISHED: "finished",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const satisfies Record<
  InstantEvalRunProjectedStatus,
  (typeof INSTANT_EVAL_RUN_WIRE_STATUSES)[number]
>;

/** One judgement, as a caller reads it. */
export function toInstantEvalJudgmentWire(
  judgment: InstantEvalJudgment,
): InstantEvalJudgmentWire {
  return {
    traceId: judgment.traceId,
    questionId: judgment.questionId,
    threadId: judgment.threadId,
    spanId: judgment.spanId,
    kind: judgment.kind,
    status: judgment.status,
    passed: judgment.passed,
    score: judgment.score,
    label: judgment.label,
    probability: judgment.probability,
    probabilities: judgment.probabilities ?? null,
    error: judgment.error,
    occurredAt: judgment.occurredAt,
  };
}

/** One run, as a caller reads it. */
export function toInstantEvalRunWire(
  row: InstantEvalRunRow,
): InstantEvalRunWire {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    parameters: row.parameters as InstantEvalRunWire["parameters"],
    questions: readInstantEvalRunQuestions(row.questions).map((question) => ({
      id: question.id,
      function: question.function,
      kind: question.kind,
      reads: question.reads,
      threshold: question.threshold ?? null,
    })),
    limit: row.rowLimit,
    status: RUN_WIRE_STATUS[row.status],
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    matchedByQuestion:
      row.matchedByQuestion as InstantEvalRunWire["matchedByQuestion"],
    failed: row.failed,
    skipped: row.skipped,
    tokens: row.tokens,
    costUsd: row.costUsd,
    priceUsd: row.priceUsd,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
