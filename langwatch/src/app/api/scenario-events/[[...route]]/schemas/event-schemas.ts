/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import { EventType, MessagesSnapshotEventSchema } from "@ag-ui/core";
import { z } from "zod";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "../enums";

// AG-UI Base Event Schema
const baseEventSchema = z.object({
  type: z.nativeEnum(EventType),
  timestamp: z.number().optional(),
  rawEvent: z.any().optional(),
});

/**
 * This is the process run id schema
 */
export const batchRunIdSchema = z.string().refine(
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

export const scenarioRunIdSchema = z.string().refine(
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

export const scenarioIdSchema = z.string();

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

// Schema for scenario result, matching the provided Python dataclass structure
export const scenarioResultsSchema = z.object({
  verdict: z.nativeEnum(Verdict),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
});
export type ScenarioResults = z.infer<typeof scenarioResultsSchema>;

// Scenario Run Finished Event
export const scenarioRunFinishedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_FINISHED),
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
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
