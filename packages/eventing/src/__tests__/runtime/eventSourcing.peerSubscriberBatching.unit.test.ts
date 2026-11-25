/**
 * @vitest-environment node
 * A batch peer subscriber takes every delivery as a batch, coalesced by the queue (ADR-066).
 * Spec: packages/eventing/specs/peer-subscriber.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { ProjectionRegistry } from "../../projections/projectionRegistry.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import type {
  EventSubscriberDefinition,
  PeerSubscriberBatchItem,
  PeerSubscriberDefinition,
} from "../../subscribers/eventSubscriber.types.ts";

const OWNER_CREATED = "lw.owner.created";
const ownerCreatedData = z.object({ ownerId: z.string() });
const ownerCreatedSchema = testEventSchema(OWNER_CREATED, ownerCreatedData);
type OwnerCreated = z.infer<typeof ownerCreatedSchema>;
type BatchItem = PeerSubscriberBatchItem<typeof ownerCreatedData>;

function created(ownerId: string, occurredAt = 1): OwnerCreated {
  return {
    id: `event-${ownerId}`,
    aggregateId: ownerId,
    aggregateType: "owner",
    tenantId: createTenantId("project-1"),
    type: OWNER_CREATED,
    version: "2026-09-30",
    createdAt: occurredAt + 10,
    occurredAt,
    data: { ownerId },
  };
}

function contextOf(event: Event, deliveryAttempt?: number) {
  return {
    tenantId: String(event.tenantId),
    aggregateId: String(event.aggregateId),
    ...(deliveryAttempt !== undefined && { deliveryAttempt }),
  };
}

/** A real registry that keeps the peer lanes it is handed, for reading their declarations. */
class CapturingRegistry extends ProjectionRegistry<Event> {
  readonly registered: EventSubscriberDefinition<Event>[] = [];

  override registerEventSubscriber(subscriber: EventSubscriberDefinition<Event>): void {
    this.registered.push(subscriber);
  }
}

/** Declares the peer subscriber on a reacting pipeline and answers the lane it registers. */
function laneOf(
  subscriber: PeerSubscriberDefinition<typeof ownerCreatedData>,
): EventSubscriberDefinition<Event> {
  const definition = definePipeline({
    name: "reactor",
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("onOwnerCreated", subscriber)
    .build();
  const registry = new CapturingRegistry({
    parseEvent: (value) => ownerCreatedSchema.parse(value),
  });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);
  const [lane] = registry.registered;
  if (!lane) throw new Error("the pipeline registered no peer lane");
  return lane;
}

describe("a batch peer subscriber", () => {
  describe("when the queue drains two due events of one group together", () => {
    /** @scenario "A batch peer subscriber receives a backed-up group in one call" */
    it("calls handleBatch once with both, in queue order, each parsed with its own context", async () => {
      const handleBatch = vi.fn(async (_items: readonly BatchItem[]) => void 0);
      const lane = laneOf({
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
        options: { coalesceMaxBatch: 3 },
        handleBatch,
      });
      const first = { ...created("owner-1", 1), idempotencyKey: "fact-owner-1" };
      const second = created("owner-2", 2);

      expect(lane.options?.coalesceMaxBatch).toBe(3);
      await lane.handleBatch?.([first, second], [contextOf(first, 2), contextOf(second, 2)]);

      expect(handleBatch).toHaveBeenCalledTimes(1);
      expect(handleBatch.mock.calls[0]?.[0]).toEqual([
        {
          data: { ownerId: "owner-1" },
          context: {
            tenantId: "project-1",
            aggregateId: "owner-1",
            deliveryAttempt: 2,
            occurredAt: 1,
            createdAt: 11,
            eventId: "event-owner-1",
            idempotencyKey: "fact-owner-1",
          },
        },
        {
          data: { ownerId: "owner-2" },
          context: {
            tenantId: "project-1",
            aggregateId: "owner-2",
            deliveryAttempt: 2,
            occurredAt: 2,
            createdAt: 12,
            eventId: "event-owner-2",
          },
        },
      ]);
    });
  });

  describe("when the queue delivers one event on its own", () => {
    /** @scenario "A single delivery reaches a batch peer subscriber as a batch of one" */
    it("calls handleBatch with a batch holding only that event", async () => {
      const handleBatch = vi.fn(async (_items: readonly BatchItem[]) => void 0);
      const lane = laneOf({ eventType: OWNER_CREATED, data: ownerCreatedData, handleBatch });
      const event = created("owner-3");

      await lane.handle(event, contextOf(event));

      expect(handleBatch).toHaveBeenCalledTimes(1);
      expect(handleBatch.mock.calls[0]?.[0]).toEqual([
        {
          data: { ownerId: "owner-3" },
          context: {
            tenantId: "project-1",
            aggregateId: "owner-3",
            occurredAt: 1,
            createdAt: 11,
            eventId: "event-owner-3",
          },
        },
      ]);
    });
  });

  describe("when a batch holds an event whose data the contract refuses", () => {
    /** @scenario "An event the contract refuses fails its whole batch" */
    it("rejects the batch without calling the subscriber", async () => {
      const handleBatch = vi.fn(async (_items: readonly BatchItem[]) => void 0);
      const lane = laneOf({
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
        options: { coalesceMaxBatch: 3 },
        handleBatch,
      });
      const readable = created("owner-4");
      const unreadable: Event = { ...created("owner-5"), data: { ownerId: 5 } };

      await expect(
        lane.handleBatch?.([readable, unreadable], [contextOf(readable), contextOf(unreadable)]),
      ).rejects.toThrow(z.ZodError);
      expect(handleBatch).not.toHaveBeenCalled();
    });
  });
});

describe("a peer subscriber that handles one event at a time", () => {
  describe("when it asks the queue to coalesce more than one event", () => {
    /** @scenario "A peer subscriber that handles one event at a time cannot ask to coalesce" */
    it("refuses the declaration naming its lane", () => {
      expect(() =>
        laneOf({
          eventType: OWNER_CREATED,
          data: ownerCreatedData,
          options: { coalesceMaxBatch: 2 },
          handle: async () => void 0,
        }),
      ).toThrow(/reactor\.onOwnerCreated.*handleBatch/);
    });
  });

  describe("when it declares no batch handler", () => {
    it("registers a lane that takes no batch", () => {
      const lane = laneOf({
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
        handle: async () => void 0,
      });

      expect(lane.handleBatch).toBeUndefined();
    });
  });

  describe("when a definition names both handlers or neither", () => {
    it("is a type error", () => {
      // @ts-expect-error a peer subscriber declares handle or handleBatch, not both
      const both: PeerSubscriberDefinition<typeof ownerCreatedData> = {
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
        handle: async () => void 0,
        handleBatch: async () => void 0,
      };
      // @ts-expect-error a peer subscriber declares one of handle and handleBatch
      const neither: PeerSubscriberDefinition<typeof ownerCreatedData> = {
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
      };

      expect([both, neither]).toHaveLength(2);
    });
  });
});
