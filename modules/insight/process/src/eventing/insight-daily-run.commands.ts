/**
 * The daily run commands, each defined from its event's data schema. The aggregate is one
 * person's schedule on one board, and each command is keyed by the request or the run it
 * names, so a retried send is the same fact.
 */

import { defineCommand } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_COMMAND_TYPES,
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_EVENT_VERSION,
  INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  insightRunRequestedEventDataSchema,
  insightRunSettledEventDataSchema,
  insightRunStartedEventDataSchema,
} from "@langwatch/insight-contract";

const scheduleSpan = ({ scheduleId }: { scheduleId: string }) => ({
  "insight.schedule.id": scheduleId,
});

export const RequestInsightRunCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.REQUEST_RUN,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_REQUESTED,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightRunRequestedEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, requestId }) =>
    `${tenantId}:${scheduleId}:run_requested:${requestId}`,
  spanAttributes: scheduleSpan,
});

export const RecordInsightRunStartedCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.RECORD_RUN_STARTED,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightRunStartedEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, runId }) =>
    `${tenantId}:${scheduleId}:run_started:${runId}`,
  spanAttributes: scheduleSpan,
});

export const SettleInsightRunCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.SETTLE_RUN,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightRunSettledEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, runId }) =>
    `${tenantId}:${scheduleId}:run_settled:${runId}`,
  spanAttributes: ({ scheduleId, outcome }) => ({
    "insight.schedule.id": scheduleId,
    "payload.outcome": outcome,
  }),
});
