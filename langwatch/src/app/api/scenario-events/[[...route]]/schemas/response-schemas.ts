/**
 * Scenario event schemas
 * Extends the AG-UI base event schema to add scenario-specific fields.
 */
import { z } from "zod";
import { ScenarioRunStatus } from "../enums";
import {
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
  scenarioIdSchema,
  batchRunIdSchema,
  scenarioResultsSchema,
  scenarioRunIdSchema,
} from "./event-schemas";

// Define response schemas
const successSchema = z.object({ success: z.boolean() });
const errorSchema = z.object({ error: z.string() });
export const runDataSchema = z.object({
  scenarioId: scenarioIdSchema,
  batchRunId: batchRunIdSchema,
  scenarioRunId: scenarioRunIdSchema,
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
  messages: scenarioMessageSnapshotSchema.shape.messages,
  timestamp: z.number(),
});
const runsSchema = z.object({ runs: z.array(runDataSchema) });
const eventsSchema = z.object({ events: z.array(scenarioEventSchema) });
export const scenarioBatchSchema = z.object({
  batchRunId: z.string(),
  scenarioCount: z.number(),
  successRate: z.number(),
  lastRunAt: z.number(), // timestamp
});

const batchesSchema = z.object({
  batches: z.array(scenarioBatchSchema),
});

export const responseSchemas = {
  success: successSchema,
  error: errorSchema,
  runs: runsSchema,
  events: eventsSchema,
  batches: batchesSchema,
  runData: runDataSchema,
};
