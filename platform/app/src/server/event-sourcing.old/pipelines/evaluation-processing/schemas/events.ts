import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { EVALUATION_EVENT_TYPES, EVALUATION_EVENT_VERSIONS } from "./constants";

/**
 * Base metadata for evaluation events.
 */
const evaluationEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Evaluation scheduled event.
 *
 * RETIRED — nothing emits this any more. The schema is load-bearing for replay:
 * both evaluation folds still handle the type, so events already committed to
 * the log must keep parsing. See `EVALUATION_EVENT_TYPES.SCHEDULED`.
 */
const evaluationScheduledEventDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
});

export const evaluationScheduledEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_EVENT_TYPES.SCHEDULED),
  version: z.literal(EVALUATION_EVENT_VERSIONS.SCHEDULED),
  data: evaluationScheduledEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationScheduledEvent = z.infer<
  typeof evaluationScheduledEventSchema
>;

/**
 * Evaluation started event.
 *
 * RETIRED — nothing emits this any more. The schema is load-bearing for replay:
 * both evaluation folds still handle the type, so events already committed to
 * the log must keep parsing. See `EVALUATION_EVENT_TYPES.STARTED`.
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
  type: z.literal(EVALUATION_EVENT_TYPES.STARTED),
  version: z.literal(EVALUATION_EVENT_VERSIONS.STARTED),
  data: evaluationStartedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationStartedEvent = z.infer<
  typeof evaluationStartedEventSchema
>;

/**
 * Evaluation completed event.
 *
 * RETIRED as an emitted event — nothing produces one any more. The schema is
 * load-bearing on the read side: both evaluation folds handle the type and
 * `evaluationAlertTriggerMatch.subscriber` subscribes to it, so events already
 * committed to the log must keep parsing. See
 * `EVALUATION_EVENT_TYPES.COMPLETED`.
 */
export const evaluationCompletedEventDataSchema = z.object({
  evaluationId: z.string(),
  /**
   * The trace this evaluation ran against — event-carried state transfer.
   * Without it an "evaluation completed" fact cannot say what it completed
   * against, and every consumer that needs the trace has to read it back off
   * the fold this same event feeds, which has no ordering guarantee against
   * its own stream.
   *
   * Optional and additive rather than a version bump, matching the `batchTotal`
   * precedent on `simulation_run.queued`: event versions are asserted with
   * `z.literal` in this repo, so a bump stops every already-committed event
   * from parsing. Every `completed` event written before this field exists
   * decodes with `traceId` absent, and absence means exactly "this event
   * cannot name a trace" — consumers skip, they never throw.
   */
  traceId: z.string().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
});

export const evaluationCompletedEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_EVENT_TYPES.COMPLETED),
  version: z.literal(EVALUATION_EVENT_VERSIONS.COMPLETED),
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
  inputs: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
});

export const evaluationReportedEventSchema = EventSchema.extend({
  type: z.literal(EVALUATION_EVENT_TYPES.REPORTED),
  version: z.literal(EVALUATION_EVENT_VERSIONS.REPORTED),
  data: evaluationReportedEventDataSchema,
  metadata: evaluationEventMetadataSchema.optional(),
});

export type EvaluationReportedEvent = z.infer<
  typeof evaluationReportedEventSchema
>;

/**
 * Union of all evaluation processing event types.
 */
export type EvaluationProcessingEvent =
  | EvaluationScheduledEvent
  | EvaluationStartedEvent
  | EvaluationCompletedEvent
  | EvaluationReportedEvent;

// Re-export type guards for backwards compatibility
export {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
  isEvaluationScheduledEvent,
  isEvaluationStartedEvent,
} from "./typeGuards";
