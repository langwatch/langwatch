/**
 * Event DATA schemas of the daily run pipeline: one aggregate per person and board. Every
 * event names the person and the board, so each can be read, and folded, on its own.
 */

import { z } from "zod";

import {
  insightRunBoardSchema,
  insightRunMaxInsightsSchema,
  insightRunOutcomeSchema,
  insightRunReasonSchema,
} from "./insight-daily-run.ts";

const scheduleRefShape = {
  scheduleId: z.string().min(1),
  userId: z.string().min(1),
  board: insightRunBoardSchema,
};

/** An operator asked for one run now. */
export const insightRunRequestedEventDataSchema = z.object({
  ...scheduleRefShape,
  requestId: z.string().min(1),
  maxInsights: insightRunMaxInsightsSchema,
});
export type InsightRunRequestedEventData = z.infer<typeof insightRunRequestedEventDataSchema>;

/** The run passed its gate and Langy took the turn. `slot` is the instant the run is for. */
export const insightRunStartedEventDataSchema = z.object({
  ...scheduleRefShape,
  runId: z.string().min(1),
  slot: z.number().int().nonnegative(),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
});
export type InsightRunStartedEventData = z.infer<typeof insightRunStartedEventDataSchema>;

/** How the run ended. A run skipped before Langy took the turn names no conversation. */
export const insightRunSettledEventDataSchema = z.object({
  ...scheduleRefShape,
  runId: z.string().min(1),
  slot: z.number().int().nonnegative(),
  outcome: insightRunOutcomeSchema,
  reason: insightRunReasonSchema.nullable(),
  filedCount: z.number().int().nonnegative(),
  conversationId: z.string().min(1).nullable(),
});
export type InsightRunSettledEventData = z.infer<typeof insightRunSettledEventDataSchema>;
