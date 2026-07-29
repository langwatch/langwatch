import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "./constants";
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
  version: z.literal(EXPERIMENT_RUN_EVENT_VERSIONS.STARTED),
  data: experimentRunStartedEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

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
  /**
   * The failure's stable code, as the serialised handled error the SSE frame
   * carries (`target_result.domainError`).
   *
   * `error` is the engine's engineer-facing string; it is what the row used to
   * hold ALONE, so a page reload turned a coded failure back into raw engine
   * text in the customer's cell. Persisting the code lets the read-back render
   * the same registry copy the live stream does (ADR-045).
   *
   * Carried whole rather than mirrored field-by-field: the shape is owned by
   * `@langwatch/handled-error`, and an event log that silently drops fields it
   * was not built with is worse than one that keeps them.
   */
  domainError: z
    .custom<SerializedHandledError>(
      (value) => typeof value === "object" && value !== null,
    )
    .nullable()
    .optional(),
  traceId: z.string().nullable().optional(),
  targets: z.array(targetSchema).optional(),
});

export const targetResultEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT),
  version: z.literal(EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT),
  data: targetResultEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

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
  inputs: z.record(z.unknown()).nullable().optional(),
  duration: z.number().nullable().optional(),
});

export const evaluatorResultEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT),
  version: z.literal(EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT),
  data: evaluatorResultEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

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
  version: z.literal(EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED),
  data: experimentRunCompletedEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

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
  isEvaluatorResultEvent,
  isExperimentRunCompletedEvent,
  isExperimentRunStartedEvent,
  isTargetResultEvent,
} from "./typeGuards";
