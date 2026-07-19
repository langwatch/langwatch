import { defineCommand } from "~/server/event-sourcing/commands/defineCommand";
import {
  INGESTION_PULL_COMMAND_TYPES,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
} from "./schemas/events";

const identity = (sourceId: string, suffix: string) =>
  `${sourceId}:ingestion_pull:${suffix}`;

export const ConfigureIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.CONFIGURED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullConfiguredCommandDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity(data.sourceId, `configure:${data.configVersion}`),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
  }),
  makeJobId: (data) =>
    identity(data.sourceId, `configure:${data.configVersion}`),
});

export const DisableIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.DISABLE,
  eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.DISABLED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullDisabledEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity(data.sourceId, `disable:${data.configVersion}`),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
  }),
  makeJobId: (data) => identity(data.sourceId, `disable:${data.configVersion}`),
});

export const RecordIngestionPullRunCompletedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunCompletedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => identity(data.sourceId, `${data.runId}:completed`),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
    "payload.event_count": data.eventCount,
  }),
  makeJobId: (data) => identity(data.sourceId, `${data.runId}:completed`),
});

export const RecordIngestionPullRunFailedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunFailedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) => identity(data.sourceId, `${data.runId}:failed`),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
  }),
  makeJobId: (data) => identity(data.sourceId, `${data.runId}:failed`),
});
