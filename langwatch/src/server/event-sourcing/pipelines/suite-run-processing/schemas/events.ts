import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { SUITE_RUN_EVENT_TYPES, SUITE_RUN_EVENT_VERSIONS } from "./constants";
import { suiteTargetSchema } from "./shared";
export type { SuiteRunStatus, ScenarioResultStatus, ScenarioVerdict } from "./shared";

/**
 * SuiteRunStarted event - emitted when a suite run begins.
 */
const suiteRunStartedEventDataSchema = z.object({
  suiteId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  total: z.number().int().nonnegative(),
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number().int().positive(),
  idempotencyKey: z.string().optional(),
});
export type SuiteRunStartedEventData = z.infer<typeof suiteRunStartedEventDataSchema>;

export const SuiteRunStartedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.STARTED),
  data: suiteRunStartedEventDataSchema,
});
export type SuiteRunStartedEvent = z.infer<typeof SuiteRunStartedEventSchema>;

/**
 * SuiteRunScenarioStarted event - emitted when an individual scenario begins.
 */
const suiteRunScenarioStartedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  targetReferenceId: z.string(),
  targetType: z.string(),
  batchRunId: z.string(),
});
export type SuiteRunScenarioStartedEventData = z.infer<typeof suiteRunScenarioStartedEventDataSchema>;

export const SuiteRunScenarioStartedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.SCENARIO_STARTED),
  data: suiteRunScenarioStartedEventDataSchema,
});
export type SuiteRunScenarioStartedEvent = z.infer<typeof SuiteRunScenarioStartedEventSchema>;

/**
 * SuiteRunScenarioResult event - emitted when an individual scenario completes.
 */
const suiteRunScenarioResultEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  targetReferenceId: z.string(),
  targetType: z.string(),
  status: z.string(),
  verdict: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  batchRunId: z.string(),
});
export type SuiteRunScenarioResultEventData = z.infer<typeof suiteRunScenarioResultEventDataSchema>;

export const SuiteRunScenarioResultEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.SCENARIO_RESULT),
  data: suiteRunScenarioResultEventDataSchema,
});
export type SuiteRunScenarioResultEvent = z.infer<typeof SuiteRunScenarioResultEventSchema>;

/**
 * SuiteRunCompleted event - emitted by fold auto-detect when Progress == Total.
 */
const suiteRunCompletedEventDataSchema = z.object({
  finishedAt: z.number(),
});
export type SuiteRunCompletedEventData = z.infer<typeof suiteRunCompletedEventDataSchema>;

export const SuiteRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(SUITE_RUN_EVENT_TYPES.COMPLETED),
  version: z.literal(SUITE_RUN_EVENT_VERSIONS.COMPLETED),
  data: suiteRunCompletedEventDataSchema,
});
export type SuiteRunCompletedEvent = z.infer<typeof SuiteRunCompletedEventSchema>;

/**
 * Union of all suite run processing event types.
 */
export type SuiteRunProcessingEvent =
  | SuiteRunStartedEvent
  | SuiteRunScenarioStartedEvent
  | SuiteRunScenarioResultEvent
  | SuiteRunCompletedEvent;

export {
  isSuiteRunStartedEvent,
  isSuiteRunScenarioStartedEvent,
  isSuiteRunScenarioResultEvent,
  isSuiteRunCompletedEvent,
} from "./typeGuards";
