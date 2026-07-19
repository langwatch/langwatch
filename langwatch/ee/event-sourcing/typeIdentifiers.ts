import {
  INGESTION_PULL_PROCESSING_COMMAND_TYPES,
  INGESTION_PULL_PROCESSING_EVENT_TYPES,
} from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";

/** Enterprise identifiers composed into the runtime's complete type sets. */
export const ENTERPRISE_EVENT_TYPE_IDENTIFIERS = [
  ...INGESTION_PULL_PROCESSING_EVENT_TYPES,
] as const;

export const ENTERPRISE_COMMAND_TYPE_IDENTIFIERS = [
  ...INGESTION_PULL_PROCESSING_COMMAND_TYPES,
] as const;

export const ENTERPRISE_AGGREGATE_TYPE_IDENTIFIERS = [
  "ingestion_pull",
] as const;
