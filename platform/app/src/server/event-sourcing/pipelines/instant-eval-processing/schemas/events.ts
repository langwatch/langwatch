/**
 * What one Instant Eval run records as it goes.
 *
 * Five events, and none of them carries judged text. `page_judged` is the one
 * that could have: it is the outcome of judging up to five hundred
 * conversations, and it carries the counts and the cursor rather than the
 * verdicts. The verdicts are written to ClickHouse by the page's own intent,
 * keyed so a redelivery collapses, which is why a hundred thousand rows with
 * three questions produces a couple of hundred events rather than three hundred
 * thousand.
 *
 * `requested` carries the run's whole definition, statement included, so the
 * event log holds what was asked. The process manager never sees it: its
 * `toPayload` view keeps ids and numbers, and the intent that runs the
 * statement reads it from the run's own row.
 *
 * @see ./constants.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import {
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
  INSTANT_EVAL_OUTCOMES,
} from "./constants";

export const instantEvalRequestedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** What the caller called the run, or null when they named nothing. */
  name: z.string().nullable(),
  /** The statement, exactly as submitted. */
  sql: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  /** The eval functions the statement projects, derived from it at creation. */
  questions: z.array(
    z.object({ id: z.string(), kind: z.string() }).passthrough(),
  ),
  rowLimit: z.number().int().positive(),
});
export type InstantEvalRequestedEventData = z.infer<
  typeof instantEvalRequestedEventDataSchema
>;

export const InstantEvalRequestedEventSchema = EventSchema.extend({
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.REQUESTED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.REQUESTED),
  data: instantEvalRequestedEventDataSchema,
});
export type InstantEvalRequestedEvent = z.infer<
  typeof InstantEvalRequestedEventSchema
>;

export const instantEvalPlannedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** Rows the key pass found, already bounded by the run's own limit. */
  total: z.number().int().nonnegative(),
  /** Rows one page judges, chosen from how large the sampled texts are. */
  pageSize: z.number().int().positive(),
  /** Whether the statement matched more rows than the run may judge. */
  isCapped: z.boolean(),
  /**
   * The optional key columns the statement projects, in catalog order.
   *
   * Carried so a page's key pass names only columns that exist: a statement
   * grouped by conversation has no `SpanId`, and naming one would refuse the
   * page rather than the run.
   */
  keyColumns: z.array(z.string()),
});
export type InstantEvalPlannedEventData = z.infer<
  typeof instantEvalPlannedEventDataSchema
>;

export const InstantEvalPlannedEventSchema = EventSchema.extend({
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.PLANNED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.PLANNED),
  data: instantEvalPlannedEventDataSchema,
});
export type InstantEvalPlannedEvent = z.infer<
  typeof InstantEvalPlannedEventSchema
>;

export const instantEvalPageJudgedEventDataSchema = z.object({
  runId: z.string().min(1),
  page: z.number().int().positive(),
  /** Rows this page judged. */
  rows: z.number().int().nonnegative(),
  /** Boolean matches of this page, or null when the run asked no boolean question. */
  matched: z.number().int().nonnegative().nullable().default(null),
  matchedByQuestion: z.record(z.string(), z.number()),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  /**
   * The last trace id of this page, which is where the next one starts.
   *
   * Null for an empty page, which is also the end of the run.
   */
  cursor: z.string().nullable(),
  cursorSpanId: z.string().nullable().default(null),
  hasNextPage: z.boolean(),
});
export type InstantEvalPageJudgedEventData = z.infer<
  typeof instantEvalPageJudgedEventDataSchema
>;

export const InstantEvalPageJudgedEventSchema = EventSchema.extend({
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.PAGE_JUDGED),
  data: instantEvalPageJudgedEventDataSchema,
});
export type InstantEvalPageJudgedEvent = z.infer<
  typeof InstantEvalPageJudgedEventSchema
>;

export const instantEvalCancelRequestedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** Who asked, when a member did rather than the platform. */
  requestedByUserId: z.string().nullable(),
});
export type InstantEvalCancelRequestedEventData = z.infer<
  typeof instantEvalCancelRequestedEventDataSchema
>;

export const InstantEvalCancelRequestedEventSchema = EventSchema.extend({
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: instantEvalCancelRequestedEventDataSchema,
});
export type InstantEvalCancelRequestedEvent = z.infer<
  typeof InstantEvalCancelRequestedEventSchema
>;

export const instantEvalFinishedEventDataSchema = z.object({
  runId: z.string().min(1),
  outcome: z.enum(INSTANT_EVAL_OUTCOMES),
  /** The code of the failure that ended it, when one did. Never prose. */
  errorCode: z.string().nullable(),
  /** What the run judged in total, summed from its pages. */
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  /** What the judge charged us, and what the customer is charged. */
  costUsd: z.number().nonnegative(),
  priceUsd: z.number().nonnegative(),
});
export type InstantEvalFinishedEventData = z.infer<
  typeof instantEvalFinishedEventDataSchema
>;

export const InstantEvalFinishedEventSchema = EventSchema.extend({
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.FINISHED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.FINISHED),
  data: instantEvalFinishedEventDataSchema,
});
export type InstantEvalFinishedEvent = z.infer<
  typeof InstantEvalFinishedEventSchema
>;

/** Union of all instant-eval-processing event types. */
export type InstantEvalProcessingEvent =
  | InstantEvalRequestedEvent
  | InstantEvalPlannedEvent
  | InstantEvalPageJudgedEvent
  | InstantEvalCancelRequestedEvent
  | InstantEvalFinishedEvent;
