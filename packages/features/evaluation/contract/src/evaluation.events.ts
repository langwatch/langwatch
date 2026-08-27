import { z } from "zod";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
} from "./evaluation-event.constants";

/**
 * Base metadata for evaluation events.
 */
const evaluationEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

const evaluationEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.literal("evaluation"),
  tenantId: z
    .string()
    .trim()
    .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
    .brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string(),
  version: z.string().date(),
  data: z.unknown(),
  metadata: evaluationEventMetadataSchema.optional(),
  idempotencyKey: z.string().optional(),
});

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

export const evaluationScheduledEventSchema = evaluationEventSchema.extend({
  type: z.literal(EVALUATION_SCHEDULED_EVENT_TYPE),
  data: evaluationScheduledEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationScheduledEventData = z.infer<typeof evaluationScheduledEventDataSchema>;
export type EvaluationScheduledEvent = z.infer<typeof evaluationScheduledEventSchema>;

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

export const evaluationStartedEventSchema = evaluationEventSchema.extend({
  type: z.literal(EVALUATION_STARTED_EVENT_TYPE),
  data: evaluationStartedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationStartedEventData = z.infer<typeof evaluationStartedEventDataSchema>;
export type EvaluationStartedEvent = z.infer<typeof evaluationStartedEventSchema>;

/**
 * Evaluation completed event - emitted when an evaluation execution finishes.
 */
export const evaluationCompletedEventDataSchema = z.object({
  evaluationId: z.string(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
});

export const evaluationCompletedEventSchema = evaluationEventSchema.extend({
  type: z.literal(EVALUATION_COMPLETED_EVENT_TYPE),
  data: evaluationCompletedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationCompletedEventData = z.infer<typeof evaluationCompletedEventDataSchema>;
export type EvaluationCompletedEvent = z.infer<typeof evaluationCompletedEventSchema>;

/**
 * Evaluation reported event - emitted when a custom SDK evaluation is reported atomically.
 * Carries evaluator identity and results in a single event, avoiding ClickHouse
 * replica lag from two-event approaches.
 */
export const evaluationReportedEventDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
});

export const evaluationReportedEventSchema = evaluationEventSchema.extend({
  type: z.literal(EVALUATION_REPORTED_EVENT_TYPE),
  data: evaluationReportedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationReportedEventData = z.infer<typeof evaluationReportedEventDataSchema>;
export type EvaluationReportedEvent = z.infer<typeof evaluationReportedEventSchema>;

/**
 * Union of all evaluation processing event types.
 */
export type EvaluationProcessingEvent =
  | EvaluationScheduledEvent
  | EvaluationStartedEvent
  | EvaluationCompletedEvent
  | EvaluationReportedEvent;
