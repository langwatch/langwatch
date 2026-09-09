import { defineCommand } from "~/server/event-sourcing/commands/defineCommand";
import {
  INGESTION_PULL_COMMAND_TYPES,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  ingestionPullAgentsListedEventDataSchema,
  ingestionPullAgentsListingRefusedEventDataSchema,
  ingestionPullAgentsListingRequestedEventDataSchema,
  ingestionPullConfiguredCommandDataSchema,
  ingestionPullDisabledEventDataSchema,
  ingestionPullRunCompletedEventDataSchema,
  ingestionPullRunFailedEventDataSchema,
} from "./schemas/events";

const identity = ({ sourceId, suffix }: { sourceId: string; suffix: string }) =>
  `${sourceId}:ingestion_pull:${suffix}`;

export const ConfigureIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.CONFIGURED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullConfiguredCommandDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `configure:${data.configVersion}`,
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
  }),
  makeJobId: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `configure:${data.configVersion}`,
    }),
});

export const DisableIngestionPullCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.DISABLE,
  eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.DISABLED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullDisabledEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `disable:${data.configVersion}`,
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
  }),
  makeJobId: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `disable:${data.configVersion}`,
    }),
});

export const RecordIngestionPullRunCompletedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunCompletedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({ sourceId: data.sourceId, suffix: `${data.runId}:completed` }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
    "payload.event_count": data.eventCount,
  }),
  makeJobId: (data) =>
    identity({ sourceId: data.sourceId, suffix: `${data.runId}:completed` }),
});

export const RecordIngestionPullRunFailedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullRunFailedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({ sourceId: data.sourceId, suffix: `${data.runId}:failed` }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.run_id": data.runId,
  }),
  makeJobId: (data) =>
    identity({ sourceId: data.sourceId, suffix: `${data.runId}:failed` }),
});

/**
 * Ask this source to say what agents it has, now.
 *
 * The only entry point for an on-demand listing. A caller emits this and is
 * done; leases, retries and concurrency all come from the pipeline, so there
 * is no second path that runs the listing inline and no timer that runs it
 * unasked.
 */
export const RequestIngestionPullAgentsListingCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.REQUEST_AGENTS_LISTING,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REQUESTED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullAgentsListingRequestedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_requested`,
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
  }),
  makeJobId: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_requested`,
    }),
});

export const RecordIngestionPullAgentsListedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTED,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullAgentsListedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_listed`,
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.agent_count": data.agentCount,
  }),
  makeJobId: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_listed`,
    }),
});

export const RecordIngestionPullAgentsListingRefusedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTING_REFUSED,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REFUSED,
  aggregateType: "ingestion_pull",
  schema: ingestionPullAgentsListingRefusedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_refused`,
    }),
  // The reason is a fixed code and the status a number, so neither can carry
  // a provider body into a span the way an error message would.
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.reason": data.reason,
  }),
  makeJobId: (data) =>
    identity({
      sourceId: data.sourceId,
      suffix: `${data.requestId}:agents_refused`,
    }),
});
