import { EventSchema } from "@langwatch/eventing";
import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";
import { experimentRunEventingTargetSchema as targetSchema } from "@langwatch/experiment-contract";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./eventing.experiment-run-event-types.adapter";

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
export type ExperimentRunStartedEvent = z.infer<typeof experimentRunStartedEventSchema>;

/**
 * Target result event - emitted when a target execution completes for a row.
 */
export const targetResultEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: z.record(z.string(), z.unknown()),
  predicted: z.record(z.string(), z.unknown()).nullable().optional(),
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
  /**
   * True when the cell was copied into this run from the board rather than
   * produced by it.
   *
   * A run holds the whole board so the results page can draw every column, but
   * a copied cell was paid for by the run that produced it. Counting its money
   * or its time again reports spend that did not happen, and counting it as
   * completed reports more cells done than the run dispatched. The fold reads
   * this field to tell the two apart.
   */
  carriedOver: z.boolean().optional(),
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
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  duration: z.number().nullable().optional(),
  /**
   * True when the verdict was copied into this run from the board rather than
   * produced by it. See `targetResultEventDataSchema.carriedOver`.
   *
   * A carried verdict still counts toward what the run scored: the run stands
   * for the board, and a reader comparing two columns needs both sides. Its
   * money does not count, for the same reason a carried output's does not.
   */
  carriedOver: z.boolean().optional(),
});

export const evaluatorResultEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT),
  data: evaluatorResultEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type EvaluatorResultEventData = z.infer<typeof evaluatorResultEventDataSchema>;
export type EvaluatorResultEvent = z.infer<typeof evaluatorResultEventSchema>;

/**
 * Trace metrics computed event - emitted when trace cost data is synced
 * from the trace processing pipeline (ECST pattern).
 */
export const traceMetricsComputedEventDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
});

export const traceMetricsComputedEventSchema = EventSchema.extend({
  type: z.literal(EXPERIMENT_RUN_EVENT_TYPES.TRACE_METRICS_COMPUTED),
  data: traceMetricsComputedEventDataSchema,
  metadata: experimentRunEventMetadataSchema.optional(),
});

export type TraceMetricsComputedEventData = z.infer<
  typeof traceMetricsComputedEventDataSchema
>;
export type TraceMetricsComputedEvent = z.infer<typeof traceMetricsComputedEventSchema>;

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
  | TraceMetricsComputedEvent
  | ExperimentRunCompletedEvent;

export {
  isEvaluatorResultEvent,
  isExperimentRunCompletedEvent,
  isExperimentRunStartedEvent,
  isTargetResultEvent,
  isTraceMetricsComputedEvent,
} from "../processes/experiment-run-event-guards.process";
