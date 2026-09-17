import type { TriggerContext } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  createSpanStorageBroadcastHandler,
  createTraceUpdateBroadcastHandler,
} from "@langwatch/trace-server";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { tryCreateWorkerTraceBroadcast } from "../worker-trace-broadcast.composition.ts";

/**
 * Spec: modules/trace/specs/trace-tenant-broadcast-worker-composition.feature
 * Tests subscriber bodies put application bytes on wire; channel and body
 * pinned by literal.
 */

class FakeRedis {
  readonly published: [string, string][] = [];

  async publish(channel: string, message: string): Promise<number> {
    this.published.push([channel, message]);
    return 1;
  }
}

function port() {
  const redis = new FakeRedis();
  const broadcast = tryCreateWorkerTraceBroadcast({
    redis: redis as unknown as RedisConnection,
  })!;
  return { redis, broadcast };
}

const foldContext = {
  tenantId: "project-1",
  aggregateId: "trace-1",
} as unknown as TriggerContext<TraceSummaryData>;

const spanEvent = {
  tenantId: "project-1",
  aggregateId: "trace-1",
} as unknown as TraceProcessingEvent;

function unreachableBroadcast() {
  return tryCreateWorkerTraceBroadcast({
    redis: {
      publish: () => Promise.reject(new Error("redis is down")),
    } as unknown as RedisConnection,
  })!;
}

describe("tryCreateWorkerTraceBroadcast", () => {
  describe("given a process holding the shared tenant broadcaster", () => {
    describe("when the trace update broadcast subscriber runs", () => {
      /** @scenario "A trace summary advancing reaches the channel the application subscribes to" */
      it("publishes onto the channel the application subscribes to", async () => {
        const { redis, broadcast } = port();

        await createTraceUpdateBroadcastHandler({ broadcast })(
          {} as TraceProcessingEvent,
          foldContext,
        );

        expect(redis.published.map(([channel]) => channel)).toEqual(["broadcast:trace_updated"]);
      });

      /** @scenario "The trace summary body is the one the browser already reads" */
      it("carries the summary-updated payload the browser already reads", async () => {
        const { redis, broadcast } = port();

        await createTraceUpdateBroadcastHandler({ broadcast })(
          {} as TraceProcessingEvent,
          foldContext,
        );

        const body = JSON.parse(redis.published[0]![1]) as { event: string };
        expect(body.event).toBe('{"event":"trace_summary_updated","traceId":"trace-1"}');
      });

      /** @scenario "The envelope carries the tenant and the producer's payload verbatim" */
      it("puts the tenant and a timestamp around the producer's payload", async () => {
        const { redis, broadcast } = port();

        await createTraceUpdateBroadcastHandler({ broadcast })(
          {} as TraceProcessingEvent,
          foldContext,
        );

        const body = JSON.parse(redis.published[0]![1]) as Record<string, unknown>;
        expect(Object.keys(body).toSorted()).toEqual(["event", "tenantId", "timestamp"]);
        expect(body.tenantId).toBe("project-1");
        expect(typeof body.timestamp).toBe("number");
      });
    });

    describe("when the span storage broadcast subscriber runs", () => {
      /** @scenario "A span landing publishes its own body, not the summary's" */
      it("carries the span-stored payload on the same channel", async () => {
        const { redis, broadcast } = port();

        await createSpanStorageBroadcastHandler({ broadcast })(
          spanEvent,
          {} as TriggerContext<unknown>,
        );

        expect(redis.published[0]![0]).toBe("broadcast:trace_updated");
        const body = JSON.parse(redis.published[0]![1]) as { event: string };
        expect(body.event).toBe('{"event":"span_stored","traceId":"trace-1"}');
      });
    });
  });

  describe("given a publisher that cannot reach Redis", () => {
    /**
     * Asserted at the PORT and again at the subscriber: the swallow is
     * doubled on purpose, so either assertion alone hides a regression in
     * the other half. Only the port-level one can see the adapter stop absorbing it.
     */
    describe("when the port is published through directly", () => {
      /** @scenario "A failed publish does not fail the ingestion that caused it" */
      it("absorbs the failure at the port rather than raising it", async () => {
        await expect(
          unreachableBroadcast().broadcastToTenant("project-1", "{}", "trace_updated"),
        ).resolves.toBeUndefined();
      });
    });

    describe("when the trace update broadcast subscriber runs", () => {
      /** @scenario "A failed publish does not fail the ingestion that caused it" */
      it("completes rather than failing the durable write that caused it", async () => {
        await expect(
          createTraceUpdateBroadcastHandler({ broadcast: unreachableBroadcast() })(
            {} as TraceProcessingEvent,
            foldContext,
          ),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a deployment that configured no Redis", () => {
    describe("when the trace broadcast composition is asked for a port", () => {
      /** @scenario "A process with no Redis composes no broadcaster" */
      it("reports that this process cannot broadcast rather than accepting one", () => {
        expect(tryCreateWorkerTraceBroadcast({ redis: null })).toBeUndefined();
      });
    });
  });
});
