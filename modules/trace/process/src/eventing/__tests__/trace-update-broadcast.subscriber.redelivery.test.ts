/**
 * @vitest-environment node
 * @unit
 * State-free notification: all event types, byte-identical message; 2s throttle is cost control.
 */
import { describe, expect, it, vi } from "vitest";

import { createTraceUpdateBroadcastHandler } from "../trace-update-broadcast.subscriber.ts";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
  createTopicAssignedEvent,
} from "./trace-subscriber.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makeBroadcastSink(fail = false) {
  const sent: string[] = [];
  return {
    sent,
    deps: {
      broadcast: {
        async broadcastToTenant(tenantId: string, event: string, eventType: "trace_updated") {
          if (fail) throw new Error("subscriber connection lost");
          sent.push(`${tenantId}|${eventType}|${event}`);
        },
      },
    },
    messages(): Set<string> {
      return new Set(sent);
    },
  };
}

const event = createSpanReceivedEvent(createOtlpSpan());

describe("given an updated trace", () => {
  describe("when the same event is handled twice", () => {
    it("sends the identical notification both times", async () => {
      const sink = makeBroadcastSink();
      const handler = createTraceUpdateBroadcastHandler(sink.deps);

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      expect(sink.sent).toHaveLength(2);
      expect(sink.messages().size).toBe(1);
      expect(sink.sent[0]).toBe(
        'tenant-1|trace_updated|{"event":"trace_summary_updated","traceId":"trace-1"}',
      );
    });

    it("sends the identical notification an hour later", async () => {
      vi.useFakeTimers();
      try {
        const sink = makeBroadcastSink();
        const handler = createTraceUpdateBroadcastHandler(sink.deps);

        vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
        await handler(event, createContext(createFoldState()));
        vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
        await handler(event, createContext(createFoldState()));

        expect(sink.messages().size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when a different event type arrives for the same trace", () => {
    /**
     * Topic assignment carries no message content, but the notification is the
     * same "go and look again". Making it differ would turn every derived event
     * into a second visible update.
     */
    it("sends the same notification, so the two cannot be told apart downstream", async () => {
      const sink = makeBroadcastSink();
      const handler = createTraceUpdateBroadcastHandler(sink.deps);

      await handler(event, createContext(createFoldState()));
      await handler(
        createTopicAssignedEvent(),
        createContext(createFoldState({ topicId: "topic-1" })),
      );

      expect(sink.messages().size).toBe(1);
    });
  });

  describe("when the broadcaster is unavailable", () => {
    it("swallows the failure so the delivery is not retried for it", async () => {
      const sink = makeBroadcastSink(true);
      const handler = createTraceUpdateBroadcastHandler(sink.deps);

      await expect(handler(event, createContext(createFoldState()))).resolves.toBeUndefined();
      expect(sink.sent).toHaveLength(0);
    });
  });
});
