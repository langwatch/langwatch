import {
  REPORT_SCHEDULE_COMMAND_TYPES,
  REPORT_SCHEDULE_EVENT_TYPES,
  reportRunRequestedEventDataSchema,
  reportRunSettledEventDataSchema,
  reportScheduleConfiguredEventDataSchema,
  reportScheduleTargetEventDataSchema,
} from "@langwatch/automation-contract";
import { defineCommand } from "@langwatch/eventing";

import { REPORT_SCHEDULE_EVENT_VERSION } from "./report-schedule.events.ts";

export const ConfigureReportScheduleCommand = defineCommand({
  commandType: REPORT_SCHEDULE_COMMAND_TYPES.CONFIGURE,
  eventType: REPORT_SCHEDULE_EVENT_TYPES.CONFIGURED,
  eventVersion: REPORT_SCHEDULE_EVENT_VERSION,
  aggregateType: "trigger",
  schema: reportScheduleConfiguredEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, occurredAt, cron, timezone }) =>
    `${triggerId}:report_configured:${occurredAt}:${cron}:${timezone}`,
  spanAttributes: ({ triggerId }) => ({ "automation.trigger.id": triggerId }),
});

export const PauseReportScheduleCommand = defineCommand({
  commandType: REPORT_SCHEDULE_COMMAND_TYPES.PAUSE,
  eventType: REPORT_SCHEDULE_EVENT_TYPES.PAUSED,
  eventVersion: REPORT_SCHEDULE_EVENT_VERSION,
  aggregateType: "trigger",
  schema: reportScheduleTargetEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, occurredAt }) => `${triggerId}:report_paused:${occurredAt}`,
  spanAttributes: ({ triggerId }) => ({ "automation.trigger.id": triggerId }),
});

export const ResumeReportScheduleCommand = defineCommand({
  commandType: REPORT_SCHEDULE_COMMAND_TYPES.RESUME,
  eventType: REPORT_SCHEDULE_EVENT_TYPES.RESUMED,
  eventVersion: REPORT_SCHEDULE_EVENT_VERSION,
  aggregateType: "trigger",
  schema: reportScheduleTargetEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, occurredAt }) => `${triggerId}:report_resumed:${occurredAt}`,
  spanAttributes: ({ triggerId }) => ({ "automation.trigger.id": triggerId }),
});

export const RequestReportRunCommand = defineCommand({
  commandType: REPORT_SCHEDULE_COMMAND_TYPES.REQUEST_RUN,
  eventType: REPORT_SCHEDULE_EVENT_TYPES.RUN_REQUESTED,
  eventVersion: REPORT_SCHEDULE_EVENT_VERSION,
  aggregateType: "trigger",
  schema: reportRunRequestedEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, requestId }) => `${triggerId}:report_run:${requestId}`,
  spanAttributes: ({ triggerId }) => ({ "automation.trigger.id": triggerId }),
});

export const SettleReportRunCommand = defineCommand({
  commandType: REPORT_SCHEDULE_COMMAND_TYPES.SETTLE_RUN,
  eventType: REPORT_SCHEDULE_EVENT_TYPES.RUN_SETTLED,
  eventVersion: REPORT_SCHEDULE_EVENT_VERSION,
  aggregateType: "trigger",
  schema: reportRunSettledEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, requestId }) => `${triggerId}:report_run_settled:${requestId}`,
  spanAttributes: ({ triggerId }) => ({ "automation.trigger.id": triggerId }),
});
