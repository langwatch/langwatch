import { z } from "zod";
import {
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
} from "./ingestion-pull.events";

export const INGESTION_PULL_COMMAND_TYPES = {
  CONFIGURE: "lw.obs.ingestion_pull.configure",
  DISABLE: "lw.obs.ingestion_pull.disable",
  RECORD_RUN_COMPLETED: "lw.obs.ingestion_pull.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.ingestion_pull.record_run_failed",
} as const;
export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = Object.values(
  INGESTION_PULL_COMMAND_TYPES,
);

export const configureIngestionPullCommandSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative().optional(),
  data: ingestionPullConfiguredCommandDataSchema,
}).strict();
export const disableIngestionPullCommandSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative().optional(),
  data: ingestionPullDisabledEventDataSchema,
}).strict();
export const recordIngestionPullRunCompletedCommandSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative().optional(),
  data: ingestionPullRunCompletedEventDataSchema,
}).strict();
export const recordIngestionPullRunFailedCommandSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative().optional(),
  data: ingestionPullRunFailedEventDataSchema,
}).strict();

export type ConfigureIngestionPullCommand = z.infer<typeof configureIngestionPullCommandSchema>;
export type DisableIngestionPullCommand = z.infer<typeof disableIngestionPullCommandSchema>;
export type RecordIngestionPullRunCompletedCommand = z.infer<typeof recordIngestionPullRunCompletedCommandSchema>;
export type RecordIngestionPullRunFailedCommand = z.infer<typeof recordIngestionPullRunFailedCommandSchema>;
export type IngestionPullProcessingCommandType = (typeof INGESTION_PULL_PROCESSING_COMMAND_TYPES)[number];
