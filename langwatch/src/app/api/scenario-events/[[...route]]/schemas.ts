/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import { z } from "zod";
import { EventType, MessagesSnapshotEventSchema } from "@ag-ui/core";

// Scenario event type enum
export enum ScenarioEventType {
  RUN_STARTED = "SCENARIO_RUN_STARTED",
  RUN_FINISHED = "SCENARIO_RUN_FINISHED",
  MESSAGE_SNAPSHOT = "SCENARIO_MESSAGE_SNAPSHOT",
}

export enum ScenarioRunStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING = "PENDING",
  FAILED = "FAILED",
}

// AG-UI Base Event Schema
const baseEventSchema = z.object({
  type: z.nativeEnum(EventType),
  timestamp: z.number().optional(),
  rawEvent: z.any().optional(),
});

const scenarioRunIdSchema = z.string().refine(
  (val) => {
    const uuid = val.replace("scenario-run-", "");
    return (
      val.startsWith("scenario-run-") &&
      z.string().uuid().safeParse(uuid).success
    );
  },
  {
    message: "ID must start with 'scenario-run-' followed by a valid UUID",
  }
);

const scenarioIdSchema = z
  .string()
  .refine(
    (val) =>
      val.startsWith("scenario-") &&
      z.string().uuid().safeParse(val.replace("scenario-", "")).success,
    {
      message: "ID must start with 'scenario-' followed by a valid UUID",
    }
  );

// Base scenario event schema with common fields
const baseScenarioEventSchema = baseEventSchema.extend({
  scenarioId: scenarioIdSchema,
  scenarioRunId: scenarioRunIdSchema,
});

// Scenario Run Started Event
// TODO: Consider metadata
export const scenarioRunStartedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_STARTED),
  //   metadata: z.object({
  //     name: z.string(),
  //     description: z.string().optional(),
  //     config: z.record(z.unknown()).optional(),
  //   }),
});

// Scenario Run Finished Event
// TODO: Consider error, metrics
export const scenarioRunFinishedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_FINISHED),
  status: z.nativeEnum(ScenarioRunStatus),
  //   error: z
  //     .object({
  //       message: z.string(),
  //       code: z.string().optional(),
  //       stack: z.string().optional(),
  //     })
  //     .optional(),
  //   metrics: z.record(z.number()).optional(),
});

// Scenario Message Snapshot Event
export const scenarioMessageSnapshotSchema = MessagesSnapshotEventSchema.merge(
  baseScenarioEventSchema.extend({
    type: z.literal(ScenarioEventType.MESSAGE_SNAPSHOT),
  })
);

// Union type for all scenario events
export const scenarioEventSchema = z.discriminatedUnion("type", [
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
]);

// Type exports
export type ScenarioRunStartedEvent = z.infer<typeof scenarioRunStartedSchema>;
export type ScenarioRunFinishedEvent = z.infer<
  typeof scenarioRunFinishedSchema
>;
export type ScenarioMessageSnapshotEvent = z.infer<
  typeof scenarioMessageSnapshotSchema
>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
