import { z } from "zod";
import { simulationMessageSchema, simulationResultsSchema } from "./shared";

export const startRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  occurredAt: z.number(),
});
export type StartRunCommandData = z.infer<typeof startRunCommandDataSchema>;

export const messageSnapshotCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type MessageSnapshotCommandData = z.infer<typeof messageSnapshotCommandDataSchema>;

export const finishRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type FinishRunCommandData = z.infer<typeof finishRunCommandDataSchema>;

export const deleteRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});
export type DeleteRunCommandData = z.infer<typeof deleteRunCommandDataSchema>;
