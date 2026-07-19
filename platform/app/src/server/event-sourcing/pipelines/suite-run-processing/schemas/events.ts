import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { SUITE_RUN_EVENT_TYPES, SUITE_RUN_EVENT_VERSIONS } from "./constants";

/**
 * SuiteRunStarted event - emitted when a suite run begins.
 */
export const suiteRunStartedEventDataSchema = z.object({
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  suiteId: z.string(),
  total: z.number(),
  scenarioIds: z.array(z.string()),
  targetIds: z.array(z.string()),
});
export type SuiteRunStartedEventData = z.infer<typeof suiteRunStartedEventDataSchema>;

export const SuiteRunStartedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.STARTED),
  data: suiteRunStartedEventDataSchema,
});
export type SuiteRunStartedEvent = z.infer<typeof SuiteRunStartedEventSchema>;

/**
 * SuiteRunItemStarted event - emitted when an individual item in the suite starts.
 */
export const suiteRunItemStartedEventDataSchema = z.object({
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
});
export type SuiteRunItemStartedEventData = z.infer<typeof suiteRunItemStartedEventDataSchema>;

export const SuiteRunItemStartedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.ITEM_STARTED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.ITEM_STARTED),
  data: suiteRunItemStartedEventDataSchema,
});
export type SuiteRunItemStartedEvent = z.infer<typeof SuiteRunItemStartedEventSchema>;

/**
 * SuiteRunItemCompleted event - emitted when an individual item finishes.
 */
export const suiteRunItemCompletedEventDataSchema = z.object({
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  status: z.string(),
  verdict: z.string().optional(),
  durationMs: z.number().optional(),
  reasoning: z.string().optional(),
  error: z.string().optional(),
});
export type SuiteRunItemCompletedEventData = z.infer<typeof suiteRunItemCompletedEventDataSchema>;

export const SuiteRunItemCompletedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.ITEM_COMPLETED),
  data: suiteRunItemCompletedEventDataSchema,
});
export type SuiteRunItemCompletedEvent = z.infer<typeof SuiteRunItemCompletedEventSchema>;

/**
 * Union of all suite run processing event types.
 */
export type SuiteRunProcessingEvent =
  | SuiteRunStartedEvent
  | SuiteRunItemStartedEvent
  | SuiteRunItemCompletedEvent;

export {
  isSuiteRunStartedEvent,
  isSuiteRunItemStartedEvent,
  isSuiteRunItemCompletedEvent,
} from "./typeGuards";
