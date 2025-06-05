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
} from "./event-schemas";

// Define response schemas
const successSchema = z.object({ success: z.boolean() });
const errorSchema = z.object({ error: z.string() });
const runDataSchema = z.object({
  scenarioId: scenarioIdSchema,
  batchRunId: batchRunIdSchema,
  status: z.nativeEnum(ScenarioRunStatus),
  results: scenarioResultsSchema.optional().nullable(),
  messages: z.array(scenarioMessageSnapshotSchema.shape.messages),
});
const runsSchema = z.object({ runs: z.array(z.string()) });
const eventsSchema = z.object({ events: z.array(scenarioEventSchema) });
export const scenarioBatchSchema = z.object({
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
  runs: runsSchema,
  events: eventsSchema,
  batches: batchesSchema,
  runData: runDataSchema,
};
