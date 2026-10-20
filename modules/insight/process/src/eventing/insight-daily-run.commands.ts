/**
 * The daily run commands, each defined from its event's data schema. The aggregate is one
 * person's schedule on one board. A run's command is keyed by the request or the run it names,
 * so a retried send is the same fact; a setting can alternate, so it is keyed by its instant.
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
  insightScheduleConfiguredEventDataSchema,
  insightScheduleTurnedOffEventDataSchema,
} from "@langwatch/insight-contract";

const scheduleSpan = ({ scheduleId }: { scheduleId: string }) => ({
  "insight.schedule.id": scheduleId,
});

export const ConfigureInsightScheduleCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.CONFIGURE,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.CONFIGURED,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightScheduleConfiguredEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, occurredAt }) =>
    `${tenantId}:${scheduleId}:configured:${occurredAt}`,
  spanAttributes: scheduleSpan,
});

export const TurnOffInsightScheduleCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.TURN_OFF,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.TURNED_OFF,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightScheduleTurnedOffEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, by, occurredAt }) =>
    `${tenantId}:${scheduleId}:turned_off:${by}:${occurredAt}`,
  spanAttributes: scheduleSpan,
});

/** Keyed by the pass's own instant, so a pass carried out twice asks each schedule once. */
export const RequestInsightScheduleRearmCommand = defineCommand({
  commandType: INSIGHT_DAILY_RUN_COMMAND_TYPES.REQUEST_REARM,
  eventType: INSIGHT_DAILY_RUN_EVENT_TYPES.REARM_REQUESTED,
  eventVersion: INSIGHT_DAILY_RUN_EVENT_VERSION,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  schema: insightScheduleConfiguredEventDataSchema,
  aggregateId: ({ scheduleId }) => scheduleId,
  idempotencyKey: ({ tenantId, scheduleId, occurredAt }) =>
    `${tenantId}:${scheduleId}:rearm_requested:${occurredAt}`,
  spanAttributes: scheduleSpan,
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
