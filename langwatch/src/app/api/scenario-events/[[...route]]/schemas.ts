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

/**
 * This is the process run id schema
 */
const batchRunIdSchema = z.string().refine(
  (val) => {
    const uuid = val.replace("batch-run-", "");
    return (
      val.startsWith("batch-run-") && z.string().uuid().safeParse(uuid).success
    );
  },
  {
    message: "ID must start with 'batch-run-' followed by a valid UUID",
  }
);

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
  batchRunId: batchRunIdSchema,
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

// Define response schemas
const successSchema = z.object({ success: z.boolean() });
const errorSchema = z.object({ error: z.string() });
const stateSchema = z.object({
  state: z.object({
    messages: z.array(z.any()),
    status: z.string(),
  }),
});
const runsSchema = z.object({ runs: z.array(z.string()) });
const eventsSchema = z.object({ events: z.array(scenarioEventSchema) });
const scenarioBatchSchema = z.object({
  batchRunId: z.string(),
  scenarioCount: z.number(),
  successRate: z.number(),
  lastRunAt: z.date(),
});

const batchesSchema = z.object({
  batches: z.array(scenarioBatchSchema),
});

export const responseSchemas = {
  success: successSchema,
  error: errorSchema,
  state: stateSchema,
  runs: runsSchema,
  events: eventsSchema,
  batches: batchesSchema,
};

// Export additional types
export type ScenarioBatch = z.infer<typeof scenarioBatchSchema>;
