/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `snapshotUpdateBroadcast` subscriber, required by
 * the `eventing-subscriber-idempotency` architecture rule.
 *
 * The contract: handling one simulation event twice leaves ONE externally
 * visible result on the tenant's SSE channel.
 *
 * What holds it, and it is not the queue:
 *
 *  1. The payload is a pure function of the event. Every field is copied from
 *     `event.aggregateId` / `event.data`; nothing is read from the clock, a
 *     counter, or a generated id. Two deliveries therefore serialise to the
 *     same bytes, so the channel carries one distinct message however many
 *     times the job runs.
 *  2. The message is a nudge, not a delta. It names the run and (on `finished`)
 *     its status, and the client answers by refetching the run. A refetch is a
 *     read of current state, so applying the nudge N times converges on the
 *     same view. Nothing downstream of it accumulates.
 *
 * What explicitly does NOT hold it: `dedupId` + `ttl`. Those are compiled by
 * `buildProjectionSubscriberDedup` (packages/eventing/src/pipeline/staticBuilder.ts)
 * into a queue-level key with a finite window that squashes PENDING jobs only.
 * A redelivery after the window closes reaches the handler, and the handler has
 * no guard of its own, as the third test here shows. Queue deduplication is not
 * sufficient under this rule, and here it is not what makes redelivery safe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { createSnapshotUpdateBroadcastSubscriber } from "../../src/subscribers/snapshot-update-broadcast.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface BroadcastMessage {
  tenantId: string;
  payload: string;
}

/** Stands in for the SSE fan-out: records every message put on a channel. */
function makeChannel() {
  const messages: BroadcastMessage[] = [];
  return {
    messages,
    broadcastUpdate: async (input: BroadcastMessage): Promise<void> => {
      messages.push(input);
    },
    /**
     * What a client can actually tell apart. Two byte-identical nudges on one
     * tenant's channel are one instruction to refetch, not two states.
     */
    distinct(): Set<string> {
      return new Set(messages.map((message) => `${message.tenantId} ${message.payload}`));
    },
  };
}

function finishedEvent(
  overrides: { aggregateId?: string; data?: Record<string, unknown> } = {},
): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: overrides.aggregateId ?? "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: 5_000,
    occurredAt: 5_000,
    version: "2026-08-06",
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: overrides.aggregateId ?? "run-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      status: "SUCCESS",
      ...overrides.data,
    },
  } as SimulationProcessingEvent;
}

function contextFor(aggregateId = "run-1") {
  return { tenantId: "project-1", aggregateId, state: undefined };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("snapshotUpdateBroadcast subscriber redelivery", () => {
  describe("given the same settled-state event handled twice", () => {
    it("leaves one distinct message on the tenant channel", async () => {
      const channel = makeChannel();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: channel.broadcastUpdate,
      });
      const event = finishedEvent();

      await subscriber.handler(event, contextFor());
      await subscriber.handler(event, contextFor());

      expect(channel.messages).toHaveLength(2);
      expect(channel.distinct().size).toBe(1);
    });
  });

  describe("given two deliveries separated by wall-clock time", () => {
    /**
     * The purity claim, made falsifiable. Reading the clock, a counter, or a
     * fresh id into the payload would make the redelivered nudge a second
     * distinct message, and the collapse above would stop being true.
     */
    it("builds the same payload from the event alone", async () => {
      vi.useFakeTimers();
      const channel = makeChannel();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: channel.broadcastUpdate,
      });
      const event = finishedEvent();

      vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
      await subscriber.handler(event, contextFor());
      vi.setSystemTime(new Date("2026-02-15T09:00:00.000Z"));
      await subscriber.handler(event, contextFor());

      const [first, second] = channel.messages;
      expect(second).toEqual(first);
    });
  });

  describe("given the queue-level dedup window", () => {
    /**
     * The window closes. That makes it a throttle on how often the UI is
     * nudged, never a promise that the handler runs once, which is why the two
     * properties above have to carry the contract on their own.
     */
    it("broadcasts on every delivery, so the window throttles rather than guarantees", async () => {
      const channel = makeChannel();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: channel.broadcastUpdate,
      });
      const event = finishedEvent();

      expect(subscriber.dedupId?.(event)).toContain(String(event.aggregateId));
      expect(Number.isFinite(subscriber.ttl)).toBe(true);

      await subscriber.handler(event, contextFor());
      await subscriber.handler(event, contextFor());

      expect(channel.messages).toHaveLength(2);
    });
  });

  describe("given two different runs", () => {
    it("keeps each run's nudge distinct", async () => {
      const channel = makeChannel();
      const subscriber = createSnapshotUpdateBroadcastSubscriber({
        broadcastUpdate: channel.broadcastUpdate,
      });

      await subscriber.handler(finishedEvent(), contextFor());
      await subscriber.handler(finishedEvent({ aggregateId: "run-2" }), contextFor("run-2"));

      expect(channel.distinct().size).toBe(2);
    });
  });
});
