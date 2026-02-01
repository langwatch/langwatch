import { z } from "zod";
import { EventSchema } from "../../../library/domain/types";
import {
  BATCH_EVALUATION_COMPLETED_EVENT_TYPE,
  BATCH_EVALUATION_STARTED_EVENT_TYPE,
  EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_TYPE,
} from "./constants";

/**
 * Base metadata for batch evaluation events.
 */
const batchEvaluationEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Target configuration stored in the batch evaluation.
 * Matches ESBatchEvaluationTarget type from ~/server/experiments/types.
 */
const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  prompt_id: z.string().nullable().optional(),
  prompt_version: z.number().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
});

/**
 * Batch evaluation started event - emitted when a batch evaluation run begins.
 */
export const batchEvaluationStartedEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(targetSchema),
});

export const batchEvaluationStartedEventSchema = EventSchema.extend({
  type: z.literal(BATCH_EVALUATION_STARTED_EVENT_TYPE),
  data: batchEvaluationStartedEventDataSchema,
  metadata: batchEvaluationEventMetadataSchema.optional(),
});

export type BatchEvaluationStartedEventData = z.infer<
  typeof batchEvaluationStartedEventDataSchema
>;
export type BatchEvaluationStartedEvent = z.infer<
  typeof batchEvaluationStartedEventSchema
>;

/**
 * Target result received event - emitted when a target execution completes for a row.
 */
export const targetResultReceivedEventDataSchema = z.object({
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

export const targetResultReceivedEventSchema = EventSchema.extend({
  type: z.literal(TARGET_RESULT_RECEIVED_EVENT_TYPE),
  data: targetResultReceivedEventDataSchema,
  metadata: batchEvaluationEventMetadataSchema.optional(),
});

export type TargetResultReceivedEventData = z.infer<
  typeof targetResultReceivedEventDataSchema
>;
export type TargetResultReceivedEvent = z.infer<
  typeof targetResultReceivedEventSchema
>;

/**
 * Evaluator result received event - emitted when an evaluator completes for a row.
 */
export const evaluatorResultReceivedEventDataSchema = z.object({
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

export const evaluatorResultReceivedEventSchema = EventSchema.extend({
  type: z.literal(EVALUATOR_RESULT_RECEIVED_EVENT_TYPE),
  data: evaluatorResultReceivedEventDataSchema,
  metadata: batchEvaluationEventMetadataSchema.optional(),
});

export type EvaluatorResultReceivedEventData = z.infer<
  typeof evaluatorResultReceivedEventDataSchema
>;
export type EvaluatorResultReceivedEvent = z.infer<
  typeof evaluatorResultReceivedEventSchema
>;

/**
 * Batch evaluation completed event - emitted when a batch evaluation run finishes.
 */
export const batchEvaluationCompletedEventDataSchema = z.object({
  runId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});

export const batchEvaluationCompletedEventSchema = EventSchema.extend({
  type: z.literal(BATCH_EVALUATION_COMPLETED_EVENT_TYPE),
  data: batchEvaluationCompletedEventDataSchema,
  metadata: batchEvaluationEventMetadataSchema.optional(),
});

export type BatchEvaluationCompletedEventData = z.infer<
  typeof batchEvaluationCompletedEventDataSchema
>;
export type BatchEvaluationCompletedEvent = z.infer<
  typeof batchEvaluationCompletedEventSchema
>;

/**
 * Union of all batch evaluation processing event types.
 */
export type BatchEvaluationProcessingEvent =
  | BatchEvaluationStartedEvent
  | TargetResultReceivedEvent
  | EvaluatorResultReceivedEvent
  | BatchEvaluationCompletedEvent;

// Re-export type guards for backwards compatibility
export {
  isBatchEvaluationCompletedEvent,
  isBatchEvaluationStartedEvent,
  isEvaluatorResultReceivedEvent,
  isTargetResultReceivedEvent,
} from "./typeGuards";
