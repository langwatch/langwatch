/**
 * The once-per-trace guarantee: a redelivered event, a retried job, or
 * a second matcher pass can all match the same automation, and each
 * must dedupe onto one match, or the customer is mailed twice.
 */
import {
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
  TriggerAction,
  type TriggerMatchRecordedEventData,
} from "@langwatch/automation-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordTriggerMatchCommand } from "../automation.pipeline.ts";

const TENANT_ID = createTenantId("project_1");
const OCCURRED_AT = 1_800_000_000_000;

function match(overrides: Partial<TriggerMatchRecordedEventData> = {}) {
  return {
    triggerId: "trigger-1",
    traceId: "trace-1",
    action: TriggerAction.SEND_EMAIL,
    actionClass: "notify" as const,
    traceDebounceMs: 30_000,
    notificationCadence: "immediate" as const,
    ...overrides,
  };
}

function record(overrides: Partial<TriggerMatchRecordedEventData> = {}, occurredAt = OCCURRED_AT) {
  const command: Parameters<InstanceType<typeof RecordTriggerMatchCommand>["handle"]>[0] = {
    type: "recordTriggerMatch",
    tenantId: TENANT_ID,
    aggregateId: "trigger-1",
    data: { ...match(overrides), occurredAt, tenantId: TENANT_ID },
  };
  const result = new RecordTriggerMatchCommand().handle(command);
  if (result instanceof Promise) throw new Error("RecordTriggerMatchCommand must be synchronous");
  const [event] = result;

  return event!;
}

describe("RecordTriggerMatchCommand", () => {
  describe("given one automation and one trace inside the debounce window", () => {
    describe("when the match is recorded more than once", () => {
      /** @scenario "An automation fires at most once per trace" */
      it("mints the same idempotency key, so the second recording dedupes away", () => {
        const first = record();
        const second = record({}, OCCURRED_AT + 1_000);

        expect(second.idempotencyKey).toBe(first.idempotencyKey);
        expect(first.idempotencyKey).toBe("trigger-1:trace-1:30000-60000000");
        expect(first.type).toBe(TRIGGER_MATCH_RECORDED_EVENT_TYPE);
        expect(first.aggregateId).toBe("trigger-1");
      });
    });

    describe("when a different trace matches the same automation", () => {
      /** @scenario "An automation fires at most once per trace" */
      it("mints its own key, so a second trace is not swallowed by the first", () => {
        expect(record({ traceId: "trace-2" }).idempotencyKey).not.toBe(record().idempotencyKey);
      });
    });

    describe("when the same trace matches again after the window has passed", () => {
      /** @scenario "An automation fires at most once per trace" */
      it("mints a new key, so a later match is a new firing rather than a duplicate", () => {
        expect(record({}, OCCURRED_AT + 30_000).idempotencyKey).not.toBe(record().idempotencyKey);
      });
    });
  });
});
