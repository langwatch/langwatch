/**
 * What one run records as it goes. None of the five carries judged text: a page
 * event carries counts and a cursor, so a hundred thousand rows is a couple of
 * hundred events. @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { z } from "zod";

import {
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
  INSTANT_EVAL_OUTCOMES,
} from "./instant-eval-event.constants.ts";

/** Portable event envelope owned by Instant Evals; Eventing consumes it structurally. */
export const instantEvalEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});

/** The run's whole definition, so the log holds what was asked. */
export const instantEvalRequestedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** What the caller called the run, or null when they named nothing. */
  name: z.string().nullable(),
  /** The statement, exactly as submitted. */
  sql: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  /** The eval functions the statement projects, derived from it at creation. */
  questions: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  rowLimit: z.number().int().positive(),
});
export type InstantEvalRequestedEventData = z.infer<typeof instantEvalRequestedEventDataSchema>;

export const instantEvalRequestedEventSchema = z.object({
  ...instantEvalEventSchema.shape,
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.REQUESTED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.REQUESTED),
  data: instantEvalRequestedEventDataSchema,
});
export type InstantEvalRequestedEvent = z.infer<typeof instantEvalRequestedEventSchema>;

export const instantEvalPlannedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** Rows the key pass found, already bounded by the run's own limit. */
  total: z.number().int().nonnegative(),
  /** Rows one page judges, chosen from how large the sampled texts are. */
  pageSize: z.number().int().positive(),
  /** Whether the statement matched more rows than the run may judge. */
  isCapped: z.boolean(),
  /**
   * The optional key columns the statement projects, in catalogue order, so a
   * page's key pass names only columns that exist: a statement grouped by
   * conversation has no `SpanId`, and naming one would refuse the page.
   */
  keyColumns: z.array(z.string()),
});
export type InstantEvalPlannedEventData = z.infer<typeof instantEvalPlannedEventDataSchema>;

export const instantEvalPlannedEventSchema = z.object({
  ...instantEvalEventSchema.shape,
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.PLANNED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.PLANNED),
  data: instantEvalPlannedEventDataSchema,
});
export type InstantEvalPlannedEvent = z.infer<typeof instantEvalPlannedEventSchema>;

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
  /** The last trace id of this page, where the next one starts. Null ends the run. */
  cursor: z.string().nullable(),
  cursorSpanId: z.string().nullable().default(null),
  hasNextPage: z.boolean(),
});
export type InstantEvalPageJudgedEventData = z.infer<typeof instantEvalPageJudgedEventDataSchema>;

export const instantEvalPageJudgedEventSchema = z.object({
  ...instantEvalEventSchema.shape,
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.PAGE_JUDGED),
  data: instantEvalPageJudgedEventDataSchema,
});
export type InstantEvalPageJudgedEvent = z.infer<typeof instantEvalPageJudgedEventSchema>;

export const instantEvalCancelRequestedEventDataSchema = z.object({
  runId: z.string().min(1),
  /** Who asked, when a member did rather than the platform. */
  requestedByUserId: z.string().nullable(),
});
export type InstantEvalCancelRequestedEventData = z.infer<
  typeof instantEvalCancelRequestedEventDataSchema
>;

export const instantEvalCancelRequestedEventSchema = z.object({
  ...instantEvalEventSchema.shape,
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: instantEvalCancelRequestedEventDataSchema,
});
export type InstantEvalCancelRequestedEvent = z.infer<typeof instantEvalCancelRequestedEventSchema>;

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
export type InstantEvalFinishedEventData = z.infer<typeof instantEvalFinishedEventDataSchema>;

export const instantEvalFinishedEventSchema = z.object({
  ...instantEvalEventSchema.shape,
  type: z.literal(INSTANT_EVAL_EVENT_TYPES.FINISHED),
  version: z.literal(INSTANT_EVAL_EVENT_VERSIONS.FINISHED),
  data: instantEvalFinishedEventDataSchema,
});
export type InstantEvalFinishedEvent = z.infer<typeof instantEvalFinishedEventSchema>;

/** Every event one run's pipeline folds. */
export type InstantEvalProcessingEvent =
  | InstantEvalRequestedEvent
  | InstantEvalPlannedEvent
  | InstantEvalPageJudgedEvent
  | InstantEvalCancelRequestedEvent
  | InstantEvalFinishedEvent;
