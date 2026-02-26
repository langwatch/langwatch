import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./constants";
import { targetSchema } from "./shared";

/**
 * Base metadata for experiment run events.
 */
const experimentRunEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Experiment run started event - emitted when an experiment run begins.
 */
export const experimentRunStartedEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(targetSchema),
});

export const experimentRunStartedEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.STARTED),
  data: experimentRunStartedEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type ExperimentRunStartedEventData = z.infer<
  typeof experimentRunStartedEventDataSchema
>;
export type ExperimentRunStartedEvent = z.infer<
  typeof experimentRunStartedEventSchema
>;

/**
 * Target result event - emitted when a target execution completes for a row.
 */
export const targetResultEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: z.record(z.unknown()),
  predicted: z.record(z.unknown()).nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
});

export const targetResultEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT),
  data: targetResultEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type TargetResultEventData = z.infer<typeof targetResultEventDataSchema>;
export type TargetResultEvent = z.infer<typeof targetResultEventSchema>;

/**
 * Evaluator result event - emitted when an evaluator completes for a row.
 */
export const evaluatorResultEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  evaluatorId: z.string(),
  evaluatorName: z.string().nullable().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  label: z.string().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  details: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
});

export const evaluatorResultEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT),
  data: evaluatorResultEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type EvaluatorResultEventData = z.infer<
  typeof evaluatorResultEventDataSchema
>;
export type EvaluatorResultEvent = z.infer<typeof evaluatorResultEventSchema>;

/**
 * Experiment run completed event - emitted when an experiment run finishes.
 */
export const experimentRunCompletedEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});

export const experimentRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.COMPLETED),
  data: experimentRunCompletedEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type ExperimentRunCompletedEventData = z.infer<
  typeof experimentRunCompletedEventDataSchema
>;
export type ExperimentRunCompletedEvent = z.infer<
  typeof experimentRunCompletedEventSchema
>;

/**
 * Union of all experiment run processing event types.
 */
export type ExperimentRunProcessingEvent =
  | ExperimentRunStartedEvent
  | TargetResultEvent
  | EvaluatorResultEvent
  | ExperimentRunCompletedEvent;

export {
	isEvaluatorResultEvent, isExperimentRunCompletedEvent,
	isExperimentRunStartedEvent, isTargetResultEvent
} from "./typeGuards";

