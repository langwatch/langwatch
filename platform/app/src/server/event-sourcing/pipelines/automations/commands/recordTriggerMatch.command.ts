import { defineCommand } from "../../../commands/defineCommand";
import {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "../schemas/constants";
import { triggerMatchRecordedEventDataSchema } from "../schemas/events";
import { settleWindowBucket } from "../settleWindow";

export const RecordTriggerMatchCommand = defineCommand({
  commandType: RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  eventType: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
  eventVersion: "2026-07-18",
  aggregateType: "trigger",
  schema: triggerMatchRecordedEventDataSchema,
  aggregateId: ({ triggerId }) => triggerId,
  groupKey: ({ triggerId }) => triggerId,
  idempotencyKey: ({ triggerId, traceId, occurredAt, traceDebounceMs }) =>
    `${triggerId}:${traceId}:${settleWindowBucket({ occurredAt, traceDebounceMs })}`,
  spanAttributes: ({ triggerId, traceId, actionClass }) => ({
    "automation.trigger.id": triggerId,
    "automation.trace.id": traceId,
    "automation.action.class": actionClass,
  }),
});
