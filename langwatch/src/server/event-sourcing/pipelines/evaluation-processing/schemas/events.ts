import { z } from "zod";
import { EventSchema } from "../../../library/domain/types";
import {
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
} from "./constants";

/**
 * Base metadata for evaluation events.
 */
const evaluationEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Evaluation scheduled event - emitted when an evaluation job is added to the queue.
 */
export const evaluationScheduledEventDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
});

export const evaluationScheduledEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_SCHEDULED_EVENT_TYPE),
  data: evaluationScheduledEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationScheduledEventData = z.infer<
  typeof evaluationScheduledEventDataSchema
>;
export type EvaluationScheduledEvent = z.infer<
  typeof evaluationScheduledEventSchema
>;

/**
 * Evaluation started event - emitted when an evaluation execution begins.
 */
export const evaluationStartedEventDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
});

export const evaluationStartedEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_STARTED_EVENT_TYPE),
  data: evaluationStartedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationStartedEventData = z.infer<
  typeof evaluationStartedEventDataSchema
>;
export type EvaluationStartedEvent = z.infer<
  typeof evaluationStartedEventSchema
>;

/**
 * Evaluation completed event - emitted when an evaluation execution finishes.
 */
export const evaluationCompletedEventDataSchema = z.object({
  evaluationId: z.string(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  label: z.string().optional(),
  details: z.string().optional(),
  error: z.string().optional(),
});

export const evaluationCompletedEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_COMPLETED_EVENT_TYPE),
  data: evaluationCompletedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationCompletedEventData = z.infer<
  typeof evaluationCompletedEventDataSchema
>;
export type EvaluationCompletedEvent = z.infer<
  typeof evaluationCompletedEventSchema
>;

/**
 * Union of all evaluation processing event types.
 */
export type EvaluationProcessingEvent =
  | EvaluationScheduledEvent
  | EvaluationStartedEvent
  | EvaluationCompletedEvent;

// Re-export type guards for backwards compatibility
export {
  isEvaluationScheduledEvent,
  isEvaluationStartedEvent,
  isEvaluationCompletedEvent,
} from "./typeGuards";
