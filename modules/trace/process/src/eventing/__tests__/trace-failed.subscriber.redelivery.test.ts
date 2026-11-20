/**
 * @vitest-environment node
 * @unit
 * A redelivered span of a failed trace sends the same trace_failed command again; the command's
 * idempotency key is the trace's, so both deliveries record one fact for peers to dedupe by.
 * @see modules/trace/specs/trace-failed-fact.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { createTraceFailedHandler } from "../trace-failed.subscriber.ts";
import { RecordTraceFailedCommand } from "../trace-project-milestones.commands.ts";
import {
  RECORD_TRACE_FAILED_COMMAND_TYPE,
  type RecordTraceFailedCommandData,
} from "../trace-project-milestones.events.ts";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

/** The fact the command appends for one sent payload. */
function factOf(payload: RecordTraceFailedCommandData) {
  const [fact] = new RecordTraceFailedCommand().handle({
    tenantId: createTenantId(payload.tenantId),
    aggregateId: RecordTraceFailedCommand.getAggregateId(payload),
    type: RECORD_TRACE_FAILED_COMMAND_TYPE,
    data: payload,
  });
  return fact;
}

describe("given a failed trace's span", () => {
  describe("when the same event is handled twice", () => {
    /** @scenario "The trace_failed fact is keyed by its project and trace" */
    it("records one trace_failed, both deliveries under the trace's idempotency key", async () => {
      const sent: RecordTraceFailedCommandData[] = [];
      const handler = createTraceFailedHandler({
        milestones: {
          recordTraceFailed: async (payload) => {
            sent.push(payload);
          },
        },
      });
      const event = createSpanReceivedEvent(createOtlpSpan());
      const context = createContext(
        createFoldState({ containsErrorStatus: true, attributes: { "langwatch.origin": "app" } }),
      );

      await handler(event, context);
      await handler(event, context);

      expect(sent[1]).toEqual(sent[0]);
      const keys = new Set(sent.map((payload) => factOf(payload)?.idempotencyKey));
      expect([...keys]).toEqual([`${sent[0]?.projectId}:trace_failed:${sent[0]?.traceId}`]);
    });
  });
});
