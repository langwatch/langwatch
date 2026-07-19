import { defineCommand } from "~/server/event-sourcing/commands/defineCommand";
import {
  INGESTION_PULL_COMMAND_TYPES,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSION,
} from "./schemas/constants";
import {
  ingestionPullConfiguredEventDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
} from "./schemas/events";

const identity = (sourceId: string, suffix: string) =>
  `${sourceId}:ingestion_pull:${suffix}`;

export const ConfigureIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  eventVersion: INGESTION_PULL_EVENT_VERSION,
  aggregateType: "ingestion_pull",
  schema: ingestionPullConfiguredEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity(data.sourceId, `configure:${data.configVersion}`),
  makeJobId: (data) =>
    identity(data.sourceId, `configure:${data.configVersion}`),
});

export const DisableIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.DISABLE,
  eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
  eventVersion: INGESTION_PULL_EVENT_VERSION,
  aggregateType: "ingestion_pull",
  schema: ingestionPullDisabledEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity(data.sourceId, `disable:${data.configVersion}`),
  makeJobId: (data) => identity(data.sourceId, `disable:${data.configVersion}`),
});

export const RecordIngestionPullRunCompletedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  eventVersion: INGESTION_PULL_EVENT_VERSION,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunCompletedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => identity(data.sourceId, `${data.runId}:completed`),
  makeJobId: (data) => identity(data.sourceId, `${data.runId}:completed`),
});

export const RecordIngestionPullRunFailedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  eventVersion: INGESTION_PULL_EVENT_VERSION,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunFailedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => identity(data.sourceId, `${data.runId}:failed`),
  makeJobId: (data) => identity(data.sourceId, `${data.runId}:failed`),
});
