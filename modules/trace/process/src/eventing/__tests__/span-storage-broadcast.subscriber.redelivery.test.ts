/**
 * @vitest-environment node
 * @unit
 * Byte-identical messages trigger viewer refetch; the 15s queue TTL is debounce, not safety.
 */
import { describe, expect, it, vi } from "vitest";

import { createSpanStorageBroadcastHandler } from "../span-storage-broadcast.subscriber.ts";
import {
  createContext,
  createOtlpSpan,
  createSpanReceivedEvent,
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

describe("given a stored span", () => {
  describe("when the same event is handled twice", () => {
    it("sends the identical notification both times", async () => {
      const sink = makeBroadcastSink();
      const handler = createSpanStorageBroadcastHandler(sink.deps);

      await handler(event, createContext(undefined));
      await handler(event, createContext(undefined));

      expect(sink.sent).toHaveLength(2);
      expect(sink.messages().size).toBe(1);
      expect(sink.sent[0]).toBe(
        'tenant-1|trace_updated|{"event":"span_stored","traceId":"trace-1"}',
      );
    });

    /**
     * Nothing in the payload reads the clock, so time passing between the two
     * deliveries cannot make the second one a different message.
     */
    it("sends the identical notification an hour later", async () => {
      vi.useFakeTimers();
      try {
        const sink = makeBroadcastSink();
        const handler = createSpanStorageBroadcastHandler(sink.deps);

        vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
        await handler(event, createContext(undefined));
        vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
        await handler(event, createContext(undefined));

        expect(sink.messages().size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the broadcaster is unavailable", () => {
    /**
     * A failed notification must not fail the handler: the framework would
     * retry the whole span for a message nobody is waiting on any more.
     */
    it("swallows the failure so the delivery is not retried for it", async () => {
      const sink = makeBroadcastSink(true);
      const handler = createSpanStorageBroadcastHandler(sink.deps);

      await expect(handler(event, createContext(undefined))).resolves.toBeUndefined();
      expect(sink.sent).toHaveLength(0);
    });
  });
});

describe("given two traces in one tenant", () => {
  it("addresses each trace separately", async () => {
    const sink = makeBroadcastSink();
    const handler = createSpanStorageBroadcastHandler(sink.deps);

    await handler(event, createContext(undefined));
    await handler(
      createSpanReceivedEvent(createOtlpSpan(), { aggregateId: "trace-2" }),
      createContext(undefined),
    );

    expect(sink.messages().size).toBe(2);
  });
});
