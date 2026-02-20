/**
 * Response schemas for scenario event API endpoints
 * Defines the structure of API responses for scenario runs, batches, and events.
 */
import { z } from "zod";
import { ScenarioRunStatus } from "../scenario-event.enums";
import {
  batchRunIdSchema,
  langwatchMetadataSchema,
  scenarioEventSchema,
  scenarioIdSchema,
  scenarioMessageSnapshotSchema,
  scenarioResultsSchema,
  scenarioRunIdSchema,
} from "./event-schemas";

/**
 * Standard success response schema
 * Used for operations that complete successfully with optional URL redirect
 */
const successSchema = z.object({
  success: z.boolean(),
  url: z.string().optional().nullable(),
});

/**
 * Standard error response schema
 * Used when API operations fail with error message
 */
const errorSchema = z.object({ error: z.string() });

/**
 * Individual scenario run data schema
 * Contains complete information about a single scenario execution
 */
export const runDataSchema = z.object({
  scenarioId: scenarioIdSchema,
  batchRunId: batchRunIdSchema,
  scenarioRunId: scenarioRunIdSchema,
  name: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      langwatch: langwatchMetadataSchema.optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
  messages: scenarioMessageSnapshotSchema.shape.messages,
  timestamp: z.number(), // Unix timestamp when run was executed
  durationInMs: z.number(), // Execution time in milliseconds
});

/**
 * Collection of scenario runs response schema
 * Used for endpoints returning multiple run records
 */
const runsSchema = z.object({ runs: z.array(runDataSchema) });

/**
 * Collection of scenario events response schema
 * Used for endpoints returning event history/logs
 */
const eventsSchema = z.object({ events: z.array(scenarioEventSchema) });

/**
 * Scenario batch summary schema
 * Contains aggregated statistics for a batch of scenario runs
 */
export const scenarioBatchSchema = z.object({
  batchRunId: z.string(),
  scenarioCount: z.number(), // Total number of scenarios in this batch
  successRate: z.number(), // Percentage of successful runs (0-1)
  lastRunAt: z.number(), // Unix timestamp of most recent run in batch
});

/**
 * Collection of scenario batches response schema
 * Used for endpoints returning batch summaries and statistics
 */
const batchesSchema = z.object({
  batches: z.array(scenarioBatchSchema),
});

/**
 * Consolidated response schemas object
 * Maps response types to their corresponding Zod schemas for validation
 */
export const responseSchemas = {
  success: successSchema,
  error: errorSchema,
  runs: runsSchema,
  events: eventsSchema,
  batches: batchesSchema,
  runData: runDataSchema,
};
