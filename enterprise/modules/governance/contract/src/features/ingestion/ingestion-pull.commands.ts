import { z } from "zod";

import {
  ingestionPullAgentsListedEventDataSchema,
  ingestionPullAgentsListingRefusedEventDataSchema,
  ingestionPullAgentsListingRequestedEventDataSchema,
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullPeopleListedEventDataSchema,
  ingestionPullPeopleListingRefusedEventDataSchema,
  ingestionPullPeopleListingRequestedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
} from "./ingestion-pull.events.ts";

export const INGESTION_PULL_COMMAND_TYPES = {
  CONFIGURE: "lw.obs.ingestion_pull.configure",
  DISABLE: "lw.obs.ingestion_pull.disable",
  RECORD_RUN_COMPLETED: "lw.obs.ingestion_pull.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.ingestion_pull.record_run_failed",
  REQUEST_AGENTS_LISTING: "lw.obs.ingestion_pull.request_agents_listing",
  RECORD_AGENTS_LISTED: "lw.obs.ingestion_pull.record_agents_listed",
  RECORD_AGENTS_LISTING_REFUSED: "lw.obs.ingestion_pull.record_agents_listing_refused",
  REQUEST_PEOPLE_LISTING: "lw.obs.ingestion_pull.request_people_listing",
  RECORD_PEOPLE_LISTED: "lw.obs.ingestion_pull.record_people_listed",
  RECORD_PEOPLE_LISTING_REFUSED: "lw.obs.ingestion_pull.record_people_listing_refused",
} as const;
export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = Object.values(INGESTION_PULL_COMMAND_TYPES);

export const configureIngestionPullCommandSchema = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: ingestionPullConfiguredCommandDataSchema,
  })
  .strict();
export const disableIngestionPullCommandSchema = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: ingestionPullDisabledEventDataSchema,
  })
  .strict();
export const recordIngestionPullRunCompletedCommandSchema = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: ingestionPullRunCompletedEventDataSchema,
  })
  .strict();
export const recordIngestionPullRunFailedCommandSchema = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: ingestionPullRunFailedEventDataSchema,
  })
  .strict();

function commandOf<Data extends z.ZodType>(data: Data) {
  return z
    .object({
      tenantId: z.string().min(1),
      occurredAt: z.number().int().nonnegative().optional(),
      data,
    })
    .strict();
}
export const requestIngestionPullAgentsListingCommandSchema = commandOf(
  ingestionPullAgentsListingRequestedEventDataSchema,
);
export const recordIngestionPullAgentsListedCommandSchema = commandOf(
  ingestionPullAgentsListedEventDataSchema,
);
export const recordIngestionPullAgentsListingRefusedCommandSchema = commandOf(
  ingestionPullAgentsListingRefusedEventDataSchema,
);
export const requestIngestionPullPeopleListingCommandSchema = commandOf(
  ingestionPullPeopleListingRequestedEventDataSchema,
);
export const recordIngestionPullPeopleListedCommandSchema = commandOf(
  ingestionPullPeopleListedEventDataSchema,
);
export const recordIngestionPullPeopleListingRefusedCommandSchema = commandOf(
  ingestionPullPeopleListingRefusedEventDataSchema,
);

export type ConfigureIngestionPullCommand = z.infer<typeof configureIngestionPullCommandSchema>;
export type DisableIngestionPullCommand = z.infer<typeof disableIngestionPullCommandSchema>;
export type RecordIngestionPullRunCompletedCommand = z.infer<
  typeof recordIngestionPullRunCompletedCommandSchema
>;
export type RecordIngestionPullRunFailedCommand = z.infer<
  typeof recordIngestionPullRunFailedCommandSchema
>;
export type RequestIngestionPullAgentsListingCommand = z.infer<
  typeof requestIngestionPullAgentsListingCommandSchema
>;
export type RecordIngestionPullAgentsListedCommand = z.infer<
  typeof recordIngestionPullAgentsListedCommandSchema
>;
export type RecordIngestionPullAgentsListingRefusedCommand = z.infer<
  typeof recordIngestionPullAgentsListingRefusedCommandSchema
>;
export type RequestIngestionPullPeopleListingCommand = z.infer<
  typeof requestIngestionPullPeopleListingCommandSchema
>;
export type RecordIngestionPullPeopleListedCommand = z.infer<
  typeof recordIngestionPullPeopleListedCommandSchema
>;
export type RecordIngestionPullPeopleListingRefusedCommand = z.infer<
  typeof recordIngestionPullPeopleListingRefusedCommandSchema
>;
export type IngestionPullProcessingCommandType =
  (typeof INGESTION_PULL_PROCESSING_COMMAND_TYPES)[number];
