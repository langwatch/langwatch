/**
 * @vitest-environment node
 * A living pipeline's retired lane drains into the peer lane that took it over (round 16).
 * Spec: packages/eventing/specs/lane-handover.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { FoldProjectionStore } from "../../projections/foldProjection.types.ts";
import type { PeerEvent } from "../../projections/peerProjection.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import type { RetiredLane } from "../../upcast/retiredLane.ts";

const SPAN_RECEIVED = "lw.owner.span_received";
const spanData = z.object({ cost: z.number(), model: z.string() });
const spanSchema = testEventSchema(SPAN_RECEIVED, spanData);
const peerSpan = [{ type: SPAN_RECEIVED, data: spanData }] as const;
const tenantId = createTenantId("project-1");

const handedOver: readonly RetiredLane[] = [
  { jobName: "spanLedger", drainsInto: { pipeline: "host", lane: "spanLedger" } },
  { jobName: "costTotals", drainsInto: { pipeline: "host", lane: "costTotals" } },
];

interface Totals {
  costs: number[];
  LastEventOccurredAt: number;
}

function memoryFoldStore() {
  const rows = new Map<string, Totals>();
  const store: FoldProjectionStore<Totals> = {
    store: async (state, context) => void rows.set(context.aggregateId, state),
    get: async (aggregateId) => {
      const state = rows.get(aggregateId);
      return state ? { kind: "folded", state } : { kind: "empty" };
    },
    getWithApplied: async (aggregateId) => {
      const state = rows.get(aggregateId);
      return state
        ? { state, appliedEventIds: [] }
        : { state: null, appliedEventIds: [], miss: "absent" };
    },
  };
  return { store, rows };
}

function ownerPipeline({ retiredLanes = handedOver }: { retiredLanes?: readonly RetiredLane[] }) {
  return definePipeline({ name: "owner_spans", aggregate: defineAggregate({ type: "owner" }) })
    .withEvents([spanSchema])
    .withRetiredLanes(retiredLanes)
    .build();
}

function hostPipeline({
  store,
  mapped,
}: {
  store: FoldProjectionStore<Totals>;
  mapped: (record: { eventId: string }) => Promise<void>;
}) {
  return definePipeline({ name: "host", aggregate: defineAggregate({ type: "global" }) })
    .withEvents([])
    .withPeerFoldProjection({
      events: peerSpan,
      fold: {
        name: "costTotals",
        version: "2026-10-07",
        eventTypes: [SPAN_RECEIVED],
        init: () => ({ costs: [], LastEventOccurredAt: 0 }),
        apply: (state, event: PeerEvent<typeof peerSpan>) => ({
          costs: [...state.costs, event.data.cost],
          LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
        }),
        store,
        LastEventOccurredAtKey: "LastEventOccurredAt",
      },
    })
    .withPeerMapProjection({
      events: peerSpan,
      map: {
        name: "spanLedger",
        eventTypes: [SPAN_RECEIVED],
        map: (event) => ({ eventId: event.id }),
        store: { append: (record) => mapped(record) },
        options: { groupKeyFn: (event) => `ledger:${event.id}` },
      },
    })
    .build();
}

function span({ id, cost }: { id: string; cost: number }): Event {
  return {
    id,
    aggregateId: "trace-a",
    aggregateType: "owner",
    tenantId,
    type: SPAN_RECEIVED,
    version: "2026-10-07",
    createdAt: 10,
    occurredAt: 10,
    data: { cost, model: "gpt-x" },
  };
}

function runtime({ retiredLanes }: { retiredLanes?: readonly RetiredLane[] } = {}) {
  const { store, rows } = memoryFoldStore();
  const mapped = vi.fn(async (_record: { eventId: string }) => undefined);
  const eventSourcing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  eventSourcing.register(ownerPipeline({ retiredLanes }));
  eventSourcing.register(hostPipeline({ store, mapped }));
  eventSourcing.startConsumers();
  return { eventSourcing, rows, mapped };
}

/** A job as the previous release's appender queued it, under the owner's own lane key. */
async function sendQueuedByPreviousRelease({
  eventSourcing,
  event,
  jobType,
  jobName,
}: {
  eventSourcing: EventSourcing;
  event: Event;
  jobType: string;
  jobName: string;
}): Promise<void> {
  await eventSourcing.globalQueue?.send({
    ...event,
    __pipelineName: "owner_spans",
    __jobType: jobType,
    __jobName: jobName,
  });
}

describe("a living pipeline's retired lanes", () => {
  describe("given a map job the previous release queued under the retired lane", () => {
    /** @scenario "A map job queued under the retired lane is delivered to the host's peer map once" */
    it("delivers it to the host's peer map exactly once", async () => {
      const { eventSourcing, mapped } = runtime();

      await sendQueuedByPreviousRelease({
        eventSourcing,
        event: span({ id: "e1", cost: 3 }),
        jobType: "handler",
        jobName: "spanLedger",
      });

      await vi.waitFor(() => expect(mapped).toHaveBeenCalledWith({ eventId: "e1" }));
      expect(mapped).toHaveBeenCalledTimes(1);
      await eventSourcing.close();
    });
  });

  describe("given a fold job the previous release queued under the retired lane", () => {
    /** @scenario "A fold job queued under the retired lane is folded by the host's peer fold once" */
    it("folds it into the host's peer fold exactly once", async () => {
      const { eventSourcing, rows, mapped } = runtime();

      await sendQueuedByPreviousRelease({
        eventSourcing,
        event: span({ id: "e2", cost: 5 }),
        jobType: "projection",
        jobName: "costTotals",
      });

      await vi.waitFor(() => expect(rows.get("trace-a")?.costs).toEqual([5]));
      expect(mapped).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("when a pipeline retires a lane it still declares", () => {
    /** @scenario "A pipeline that still declares a lane cannot retire it" */
    it("refuses to build, naming the pipeline and the lane", () => {
      const build = () =>
        definePipeline({ name: "owner_spans", aggregate: defineAggregate({ type: "owner" }) })
          .withEvents([spanSchema])
          .withEventSubscriber("spanLedger", {
            events: [SPAN_RECEIVED],
            handler: async () => undefined,
          })
          .withRetiredLanes(handedOver)
          .build();

      expect(build).toThrow(/Pipeline "owner_spans" retires the lane "spanLedger"/);
    });
  });

  describe("given a pipeline that retires no lane", () => {
    /** @scenario "A pipeline that retires no lane routes as before" */
    it("rejects a job under an unregistered lane key for retry", async () => {
      const { eventSourcing, mapped } = runtime({ retiredLanes: [] });

      await expect(
        sendQueuedByPreviousRelease({
          eventSourcing,
          event: span({ id: "e3", cost: 1 }),
          jobType: "handler",
          jobName: "spanLedger",
        }),
      ).rejects.toMatchObject({ name: "QueueError" });
      expect(mapped).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });
});
