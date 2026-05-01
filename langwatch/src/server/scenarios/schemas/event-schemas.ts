/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import {
  EventType,
  MessageSchema,
  MessagesSnapshotEventSchema,
} from "@ag-ui/core";
import { z } from "zod";
import { chatMessageSchema } from "~/server/tracer/types";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "../scenario-event.enums";

/**
 * AG-UI Base Event Schema
 * Provides the foundation for all events with type, timestamp, and raw event data
 */
const baseEventSchema = z.object({
  type: z.nativeEnum(EventType),
  timestamp: z.number(),
  rawEvent: z.any().optional(),
});

/**
 * Batch Run ID Schema
 */
export const batchRunIdSchema = z.string();

/**
 * Scenario Run ID Schema
 */
export const scenarioRunIdSchema = z.string();

/**
 * Scenario ID Schema
 */
export const scenarioIdSchema = z.string();

/**
 * Base Scenario Event Schema
 * Common fields shared by all scenario events including batch tracking and scenario identification.
 * Extends the base event schema with scenario-specific identifiers.
 */
const baseScenarioEventSchema = baseEventSchema.extend({
  batchRunId: batchRunIdSchema,
  scenarioId: scenarioIdSchema,
  scenarioRunId: scenarioRunIdSchema,
  scenarioSetId: z.string().optional().default("default").transform((v) => v || "default"),
});

/**
 * LangWatch platform metadata schema.
 * Reserved namespace for platform-internal context injected by the suite runner.
 * Direct SDK users should not populate this.
 */
export const langwatchMetadataSchema = z.object({
  targetReferenceId: z.string(),
  targetType: z.enum(["prompt", "http", "code", "workflow"]),
  simulationSuiteId: z.string().optional(),
});

/**
 * Scenario Run Started Event Schema
 * Captures the initiation of a scenario run with metadata about the scenario being executed.
 * Contains the scenario name and optional description for identification purposes.
 * User-defined metadata fields pass through via .passthrough().
 * The langwatch namespace is strictly validated.
 */
export const scenarioRunStartedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_STARTED),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      langwatch: langwatchMetadataSchema.optional(),
    })
    .passthrough(),
});

/**
 * Scenario Results Schema
 * Defines the structure for scenario evaluation results including verdict and criteria analysis.
 * Matches the Python dataclass structure used in the evaluation system.
 */
export const scenarioResultsSchema = z.object({
  verdict: z.nativeEnum(Verdict),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  error: z.string().optional(),
});
export type ScenarioResults = z.infer<typeof scenarioResultsSchema>;

/**
 * Scenario Run Finished Event Schema
 * Captures the completion of a scenario run with final status and evaluation results.
 * Status indicates success/failure, while results contain detailed evaluation outcomes.
 */
export const scenarioRunFinishedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_FINISHED),
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
});

/**
 * Scenario Message Snapshot Event Schema
 * Captures the conversation state at a specific point during scenario execution.
 * Includes searchable_content and payload for full message functionality.
 */
export const scenarioMessageSnapshotSchema = MessagesSnapshotEventSchema.merge(
  baseScenarioEventSchema.extend({
    type: z.literal(ScenarioEventType.MESSAGE_SNAPSHOT),
    messages: z.array(
      z.intersection(
        z.union([MessageSchema, chatMessageSchema]),
        z.object({
          id: z.string().optional(),
          trace_id: z.string().optional(),
        }),
      ),
    ),
  }),
);

/**
 * Scenario Text Message Start Event Schema
 * Emitted when a message begins (placeholder). Persisted via event-sourcing.
 */
export const scenarioTextMessageStartSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_START),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});

/**
 * Scenario Text Message End Event Schema
 * Emitted when a message is complete with full content. Persisted via event-sourcing.
 */
export const scenarioTextMessageEndSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_END),
  messageId: z.string(),
  role: z.string(),
  content: z.string().optional(),
  message: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});

/**
 * Scenario Text Message Content Event Schema (broadcast only)
 * Streaming delta for real-time UX, not persisted.
 */
export const scenarioTextMessageContentSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TEXT_MESSAGE_CONTENT),
  messageId: z.string(),
  delta: z.string(),
});

/**
 * Scenario Tool Call Start Event Schema (broadcast only)
 */
export const scenarioToolCallStartSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TOOL_CALL_START),
  toolCallId: z.string(),
  toolCallName: z.string(),
  parentMessageId: z.string().optional(),
});

/**
 * Scenario Tool Call Args Event Schema (broadcast only)
 */
export const scenarioToolCallArgsSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TOOL_CALL_ARGS),
  toolCallId: z.string(),
  delta: z.string(),
});

/**
 * Scenario Tool Call End Event Schema (broadcast only)
 */
export const scenarioToolCallEndSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.TOOL_CALL_END),
  toolCallId: z.string(),
});

/**
 * Scenario Event Union Schema
 * Discriminated union of all possible scenario event types.
 * Enables type-safe handling of different event types based on the 'type' field.
 */
export const scenarioEventSchema = z.discriminatedUnion("type", [
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
  scenarioTextMessageStartSchema,
  scenarioTextMessageEndSchema,
  scenarioTextMessageContentSchema,
  scenarioToolCallStartSchema,
  scenarioToolCallArgsSchema,
  scenarioToolCallEndSchema,
]);
