/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import { EventType, MessagesSnapshotEventSchema } from "@ag-ui/core";
import { z } from "zod";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "../enums";
import { parse } from "ksuid";

/**
 * Safely parses a xksuid string.
 * @param id - The xksuid string to parse.
 * @returns True if the xksuid string is valid, false otherwise.
 */
export const safeParseXKsuid = (id: string | undefined) => {
  try {
    if (!id) return false;
    parse(id);
    return true;
  } catch {
    return false;
  }
};

/**
 * AG-UI Base Event Schema
 * Provides the foundation for all events with type, timestamp, and raw event data
 */
const baseEventSchema = z.object({
  type: z.nativeEnum(EventType),
  timestamp: z.number().optional(),
  rawEvent: z.any().optional(),
});

/**
 * Batch Run ID Schema
 * Validates batch run identifiers that must start with 'scenario_batch_run_'
 * Used to group multiple scenario runs together in a single execution batch.
 */
export const batchRunIdSchema = z.string().refine(
  (val) => {
    const prefix = "scenario_batch_run_";
    if (!val.startsWith(prefix)) return false;
    const id = val.slice(prefix.length);
    return safeParseXKsuid(id);
  },
  {
    message:
      "ID must be a valid ksuid, with the resource 'scenario_batch_run_'",
  }
);

/**
 * Scenario Run ID Schema
 * Validates scenario run identifiers that must start with 'scenario_run_' followed by a ksuid.
 * Each scenario run represents a single execution of a scenario within a batch.
 */
export const scenarioRunIdSchema = z.string().refine(
  (val) => {
    const prefix = "scenario_run_";
    if (!val.startsWith(prefix)) return false;
    const id = val.slice(prefix.length);
    return safeParseXKsuid(id);
  },
  {
    message: "ID must be a valid ksuid, with the resource 'scenario_run_'",
  }
);

/**
 * Scenario ID Schema
 * Simple string identifier for scenarios. Used to reference specific test scenarios.
 */
export const scenarioIdSchema = z.string().refine(
  (val) => {
    const [resource, id] = val.split("_");
    return resource === "scenario" && safeParseXKsuid(id);
  },
  {
    message: "ID must be a valid ksuid, with the resource 'scenario_run_'",
  }
);

/**
 * Base Scenario Event Schema
 * Common fields shared by all scenario events including batch tracking and scenario identification.
 * Extends the base event schema with scenario-specific identifiers.
 */
const baseScenarioEventSchema = baseEventSchema.extend({
  batchRunId: batchRunIdSchema,
  scenarioId: scenarioIdSchema,
  scenarioRunId: scenarioRunIdSchema,
  scenarioSetId: z.string().optional().default("default"),
});

/**
 * Scenario Run Started Event Schema
 * Captures the initiation of a scenario run with metadata about the scenario being executed.
 * Contains the scenario name and optional description for identification purposes.
 */
export const scenarioRunStartedSchema = baseScenarioEventSchema.extend({
  type: z.literal(ScenarioEventType.RUN_STARTED),
  metadata: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
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
 * Merges AG-UI's message snapshot schema with scenario-specific fields for tracking conversation flow.
 */
export const scenarioMessageSnapshotSchema = MessagesSnapshotEventSchema.merge(
  baseScenarioEventSchema.extend({
    type: z.literal(ScenarioEventType.MESSAGE_SNAPSHOT),
  })
);

/**
 * Scenario Event Union Schema
 * Discriminated union of all possible scenario event types.
 * Enables type-safe handling of different event types based on the 'type' field.
 */
export const scenarioEventSchema = z.discriminatedUnion("type", [
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
]);
