// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_COMMAND_TYPES,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  ingestionPullAgentsListedEventDataSchema,
  ingestionPullAgentsListingRefusedEventDataSchema,
  ingestionPullAgentsListingRequestedEventDataSchema,
  ingestionPullPeopleListedEventDataSchema,
  ingestionPullPeopleListingRefusedEventDataSchema,
  ingestionPullPeopleListingRequestedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import { defineCommand } from "@langwatch/eventing";

const listingIdentity = ({
  sourceId,
  requestId,
  suffix,
}: {
  sourceId: string;
  requestId: string;
  suffix: string;
}) => `${sourceId}:ingestion_pull:${requestId}:${suffix}`;

/** The only entry point for an on-demand listing; leases and retries come from the pipeline. */
export const RequestIngestionPullAgentsListingCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.REQUEST_AGENTS_LISTING,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REQUESTED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullAgentsListingRequestedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_requested",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_requested",
    }),
});

export const RecordIngestionPullAgentsListedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTED,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullAgentsListedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_listed",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.agent_count": data.agentCount,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_listed",
    }),
});

export const RecordIngestionPullAgentsListingRefusedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTING_REFUSED,
  eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REFUSED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullAgentsListingRefusedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_refused",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.reason": data.reason,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "agents_refused",
    }),
});

export const RequestIngestionPullPeopleListingCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.REQUEST_PEOPLE_LISTING,
  eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REQUESTED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullPeopleListingRequestedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_requested",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_requested",
    }),
});

/** Counts, never a name; the withheld count stays off spans because its movement dates an erasure. */
export const RecordIngestionPullPeopleListedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_PEOPLE_LISTED,
  eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullPeopleListedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_listed",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.directory_person_count": data.directoryPersonCount,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_listed",
    }),
});

export const RecordIngestionPullPeopleListingRefusedCommand = defineCommand({
  commandType: INGESTION_PULL_COMMAND_TYPES.RECORD_PEOPLE_LISTING_REFUSED,
  eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED,
  eventVersion: INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REFUSED,
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  schema: ingestionPullPeopleListingRefusedEventDataSchema,
  aggregateId: (data) => data.sourceId,
  idempotencyKey: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_refused",
    }),
  spanAttributes: (data) => ({
    "payload.source_id": data.sourceId,
    "payload.request_id": data.requestId,
    "payload.reason": data.reason,
  }),
  makeJobId: (data) =>
    listingIdentity({
      sourceId: data.sourceId,
      requestId: data.requestId,
      suffix: "people_refused",
    }),
});
