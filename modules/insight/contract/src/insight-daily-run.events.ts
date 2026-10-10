/**
 * Event DATA schemas of the daily run pipeline: one aggregate per person and board. Every
 * event names the person and the board, so each can be read, and folded, on its own.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  insightRunBoardSchema,
  insightRunHourSchema,
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
const insightRunRequestedEventDataSchemaDefinition = z.object({
  ...scheduleRefShape,
  requestId: z.string().min(1),
  maxInsights: insightRunMaxInsightsSchema,
});
export interface InsightRunRequestedEventDataSchema extends Named<
  typeof insightRunRequestedEventDataSchemaDefinition
> {}
export const insightRunRequestedEventDataSchema: InsightRunRequestedEventDataSchema =
  insightRunRequestedEventDataSchemaDefinition;
export type InsightRunRequestedEventData = z.infer<typeof insightRunRequestedEventDataSchema>;

/** The run passed its gate and Langy took the turn. `slot` is the instant the run is for. */
const insightRunStartedEventDataSchemaDefinition = z.object({
  ...scheduleRefShape,
  runId: z.string().min(1),
  slot: z.number().int().nonnegative(),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
});
export interface InsightRunStartedEventDataSchema extends Named<
  typeof insightRunStartedEventDataSchemaDefinition
> {}
export const insightRunStartedEventDataSchema: InsightRunStartedEventDataSchema =
  insightRunStartedEventDataSchemaDefinition;
export type InsightRunStartedEventData = z.infer<typeof insightRunStartedEventDataSchema>;

/** How the run ended. A run skipped before Langy took the turn names no conversation. */
const insightRunSettledEventDataSchemaDefinition = z.object({
  ...scheduleRefShape,
  runId: z.string().min(1),
  slot: z.number().int().nonnegative(),
  outcome: insightRunOutcomeSchema,
  reason: insightRunReasonSchema.nullable(),
  filedCount: z.number().int().nonnegative(),
  conversationId: z.string().min(1).nullable(),
});
export interface InsightRunSettledEventDataSchema extends Named<
  typeof insightRunSettledEventDataSchemaDefinition
> {}
export const insightRunSettledEventDataSchema: InsightRunSettledEventDataSchema =
  insightRunSettledEventDataSchemaDefinition;
export type InsightRunSettledEventData = z.infer<typeof insightRunSettledEventDataSchema>;

/**
 * What the schedule runs with: the person turned it on or changed it, or a reconcile pass
 * hands its process the row's settings again. The zone was checked at the door, so a stored
 * event parses whatever zones a later runtime knows.
 */
const insightScheduleConfiguredEventDataSchemaDefinition = z.object({
  ...scheduleRefShape,
  hour: insightRunHourSchema,
  timezone: z.string().min(1).max(64),
  maxInsights: insightRunMaxInsightsSchema,
});
export interface InsightScheduleConfiguredEventDataSchema extends Named<
  typeof insightScheduleConfiguredEventDataSchemaDefinition
> {}
export const insightScheduleConfiguredEventDataSchema: InsightScheduleConfiguredEventDataSchema =
  insightScheduleConfiguredEventDataSchemaDefinition;
export type InsightScheduleConfiguredEventData = z.infer<
  typeof insightScheduleConfiguredEventDataSchema
>;

/** The daily run is off. `system`: a run found the board gone, and `reason` says how it ended. */
const insightScheduleTurnedOffEventDataSchemaDefinition = z.object({
  ...scheduleRefShape,
  by: z.enum(["person", "system"]),
  reason: insightRunReasonSchema.nullable(),
});
export interface InsightScheduleTurnedOffEventDataSchema extends Named<
  typeof insightScheduleTurnedOffEventDataSchemaDefinition
> {}
export const insightScheduleTurnedOffEventDataSchema: InsightScheduleTurnedOffEventDataSchema =
  insightScheduleTurnedOffEventDataSchemaDefinition;
export type InsightScheduleTurnedOffEventData = z.infer<
  typeof insightScheduleTurnedOffEventDataSchema
>;
