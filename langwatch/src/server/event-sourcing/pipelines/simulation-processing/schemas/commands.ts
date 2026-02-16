import { z } from "zod";
import {
  SIMULATION_RUN_STATUS,
  simulationMessageSchema,
  simulationResultsSchema,
} from "./shared";

const baseSimulationSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  occurredAt: z.number(),
});

/**
 * Command data for starting a simulation run.
 */
export const startRunCommandDataSchema = baseSimulationSchema.extend({
  metadata: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
});

export type StartRunCommandData = z.infer<typeof startRunCommandDataSchema>;

/**
 * Command data for recording a message snapshot.
 */
export const messageSnapshotCommandDataSchema = baseSimulationSchema.extend({
  messages: z.array(simulationMessageSchema),
});

export type MessageSnapshotCommandData = z.infer<
  typeof messageSnapshotCommandDataSchema
>;

/**
 * Command data for finishing a simulation run.
 */
export const finishRunCommandDataSchema = baseSimulationSchema.extend({
  status: z.enum(SIMULATION_RUN_STATUS),
  results: simulationResultsSchema.optional().nullable(),
});

export type FinishRunCommandData = z.infer<typeof finishRunCommandDataSchema>;

/**
 * Command data for deleting a simulation run (soft-delete).
 */
export const deleteRunCommandDataSchema = baseSimulationSchema;

export type DeleteRunCommandData = z.infer<typeof deleteRunCommandDataSchema>;
