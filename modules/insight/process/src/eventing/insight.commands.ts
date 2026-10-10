/**
 * The insight commands, each defined from its event's data schema. The aggregate is the
 * insight; the queue lane is the project, so one project's acts land in order.
 */

import { defineCommand } from "@langwatch/eventing";
import {
  INSIGHT_AGGREGATE_TYPE,
  INSIGHT_COMMAND_TYPES,
  INSIGHT_EVENT_TYPES,
  INSIGHT_EVENT_VERSIONS,
  insightFiledEventDataSchema,
  insightReaderEventDataSchema,
} from "@langwatch/insight-contract";

const byProject = (data: { tenantId: string }): string => data.tenantId;

/** Filed once per insight id: the service mints the id, so a retried send is the same filing. */
export const FileInsightCommand = defineCommand({
  commandType: INSIGHT_COMMAND_TYPES.FILE,
  eventType: INSIGHT_EVENT_TYPES.FILED,
  eventVersion: INSIGHT_EVENT_VERSIONS.FILED,
  aggregateType: INSIGHT_AGGREGATE_TYPE,
  schema: insightFiledEventDataSchema,
  aggregateId: (data) => data.insightId,
  groupKey: byProject,
  idempotencyKey: (data) => `${data.tenantId}:insight:${data.insightId}:filed`,
  spanAttributes: (data) => ({ "payload.tone": data.tone, "payload.valid_days": data.validDays }),
});

/** Seen is a fact that happens once per reader, so it is keyed by the reader alone. */
export const MarkInsightSeenCommand = defineCommand({
  commandType: INSIGHT_COMMAND_TYPES.MARK_SEEN,
  eventType: INSIGHT_EVENT_TYPES.SEEN,
  eventVersion: INSIGHT_EVENT_VERSIONS.SEEN,
  aggregateType: INSIGHT_AGGREGATE_TYPE,
  schema: insightReaderEventDataSchema,
  aggregateId: (data) => data.insightId,
  groupKey: byProject,
  idempotencyKey: (data) => `${data.tenantId}:insight:${data.insightId}:seen:${data.userId}`,
});

/** Done and kept can alternate, so each act is keyed by when it happened too. */
export const ArchiveInsightCommand = defineCommand({
  commandType: INSIGHT_COMMAND_TYPES.ARCHIVE,
  eventType: INSIGHT_EVENT_TYPES.ARCHIVED,
  eventVersion: INSIGHT_EVENT_VERSIONS.ARCHIVED,
  aggregateType: INSIGHT_AGGREGATE_TYPE,
  schema: insightReaderEventDataSchema,
  aggregateId: (data) => data.insightId,
  groupKey: byProject,
  idempotencyKey: (data) =>
    `${data.tenantId}:insight:${data.insightId}:archived:${data.userId}:${data.occurredAt}`,
});

export const KeepInsightCommand = defineCommand({
  commandType: INSIGHT_COMMAND_TYPES.KEEP,
  eventType: INSIGHT_EVENT_TYPES.KEPT,
  eventVersion: INSIGHT_EVENT_VERSIONS.KEPT,
  aggregateType: INSIGHT_AGGREGATE_TYPE,
  schema: insightReaderEventDataSchema,
  aggregateId: (data) => data.insightId,
  groupKey: byProject,
  idempotencyKey: (data) =>
    `${data.tenantId}:insight:${data.insightId}:kept:${data.userId}:${data.occurredAt}`,
});
