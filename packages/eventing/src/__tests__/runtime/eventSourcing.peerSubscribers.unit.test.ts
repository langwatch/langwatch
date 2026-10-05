/**
 * @vitest-environment node
 * A module reacts to a peer pipeline's event from its own side (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/peer-subscriber.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types.ts";
import { ProjectionRegistry } from "../../projections/projectionRegistry.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import type {
  EventSubscriberDefinition,
  PeerSubscriberContext,
} from "../../subscribers/eventSubscriber.types.ts";

const OWNER_CREATED = "lw.owner.created";
const ownerCreatedData = z.object({ ownerId: z.string() });
const ownerCreatedSchema = testEventSchema(OWNER_CREATED, ownerCreatedData);
type OwnerCreated = z.infer<typeof ownerCreatedSchema>;

function ownerPipeline() {
  return definePipeline({ name: "owner_lifecycle", aggregate: defineAggregate({ type: "owner" }) })
    .withEvents([ownerCreatedSchema])
    .build();
}

function reactorPipeline(handle: (data: { ownerId: string }) => Promise<void>) {
  return definePipeline({ name: "reactor", aggregate: defineAggregate({ type: "global" }) })
    .withEvents([])
    .withPeerSubscriber("onOwnerCreated", {
      eventType: OWNER_CREATED,
      data: ownerCreatedData,
      handle: (data) => handle(data),
    })
    .build();
}

function meteringPipeline(append: () => Promise<void>) {
  const meter: MapProjectionDefinition<{ eventId: string }, Event> = {
    name: "everyEventMeter",
    eventTypes: [OWNER_CREATED],
    map: (event) => ({ eventId: event.id }),
    store: { append },
  };
  return definePipeline({ name: "metering", aggregate: defineAggregate({ type: "global" }) })
    .withEvents([])
    .withGlobalMapProjection(meter)
    .build();
}

function created(ownerId: string): OwnerCreated {
  return {
    id: `event-${ownerId}`,
    aggregateId: ownerId,
    aggregateType: "owner",
    tenantId: createTenantId("project-1"),
    type: OWNER_CREATED,
    version: "2026-09-30",
    createdAt: 1,
    occurredAt: 1,
    data: { ownerId },
  };
}

/** A real registry that keeps the peer lanes it is handed, for reading their declarations. */
class CapturingRegistry extends ProjectionRegistry<Event> {
  readonly registered: EventSubscriberDefinition<Event>[] = [];

  override registerEventSubscriber(subscriber: EventSubscriberDefinition<Event>): void {
    this.registered.push(subscriber);
  }
}

function runtime() {
  return EventSourcing.createWithStores({ eventStore: EventStoreMemory.createForTesting() });
}

describe("a peer subscriber", () => {
  describe.each([
    { order: "the owner registers first", reactorFirst: false },
    { order: "the reacting module registers first", reactorFirst: true },
  ])("given $order", ({ reactorFirst }) => {
    /** @scenario "A module reacts to a peer pipeline's event from its own pipeline" */
    it("hands the reacting module the event's data, parsed with the contract's schema", async () => {
      const handle = vi.fn(async (_data: { ownerId: string }) => void 0);
      const eventSourcing = runtime();
      const reactor = reactorPipeline(handle);
      if (reactorFirst) eventSourcing.register(reactor);
      const owner = eventSourcing.register(ownerPipeline());
      if (!reactorFirst) eventSourcing.register(reactor);

      await owner.service.storeEvents([created("owner-1")], {
        tenantId: createTenantId("project-1"),
      });

      await vi.waitFor(() => expect(handle).toHaveBeenCalledWith({ ownerId: "owner-1" }));
      await eventSourcing.close();
    });
  });

  describe("given another module declares a global map projection too", () => {
    /** @scenario "Several modules declare global lanes in one process" */
    it("registers both and routes the event to each", async () => {
      const handle = vi.fn(async (_data: { ownerId: string }) => void 0);
      const append = vi.fn(async () => void 0);
      const eventSourcing = runtime();
      eventSourcing.register(meteringPipeline(append));
      const owner = eventSourcing.register(ownerPipeline());
      eventSourcing.register(reactorPipeline(handle));

      await owner.service.storeEvents([created("owner-2")], {
        tenantId: createTenantId("project-1"),
      });

      await vi.waitFor(() => {
        expect(handle).toHaveBeenCalledWith({ ownerId: "owner-2" });
        expect(append).toHaveBeenCalledTimes(1);
      });
      await eventSourcing.close();
    });
  });

  describe("given the global registry already routes", () => {
    /** @scenario "A global lane declared after routing started is refused by name" */
    it("refuses a later pipeline's peer subscriber by its lane name", async () => {
      const eventSourcing = runtime();
      eventSourcing.register(meteringPipeline(async () => void 0));
      eventSourcing.startConsumers();

      expect(() => eventSourcing.register(reactorPipeline(async () => void 0))).toThrow(
        /reactor\.onOwnerCreated/,
      );
      await eventSourcing.close();
    });
  });

  describe("given one pipeline declares the same peer subscriber twice", () => {
    it("refuses the second by its lane name", () => {
      const declaration = {
        eventType: OWNER_CREATED,
        data: ownerCreatedData,
        handle: async () => void 0,
      };

      expect(() =>
        definePipeline({ name: "reactor", aggregate: defineAggregate({ type: "global" }) })
          .withEvents([])
          .withPeerSubscriber("onOwnerCreated", declaration)
          .withPeerSubscriber("onOwnerCreated", declaration),
      ).toThrow(/reactor\.onOwnerCreated/);
    });
  });

  describe("given a peer subscriber declares enqueue options", () => {
    /** @scenario "A peer subscriber carries its enqueue options and the event's instant" */
    it("registers the options on its lane and hands the handler the event's occurredAt and eventId", async () => {
      const handle = vi.fn(
        async (_data: { ownerId: string }, _context: PeerSubscriberContext) => void 0,
      );
      const options = {
        delay: 5_000,
        deduplication: { makeId: (event: Event) => `owner:${event.aggregateId}`, ttlMs: 5_000 },
        groupKeyFn: (event: Event) => `group:${event.tenantId}`,
      };
      const definition = definePipeline({
        name: "reactor",
        aggregate: defineAggregate({ type: "global" }),
      })
        .withEvents([])
        .withPeerSubscriber("onOwnerCreated", {
          eventType: OWNER_CREATED,
          data: ownerCreatedData,
          options,
          handle,
        })
        .build();
      const registry = new CapturingRegistry({
        parseEvent: (value) => ownerCreatedSchema.parse(value),
      });
      for (const projection of definition.globalProjections ?? []) projection.register(registry);

      const [lane] = registry.registered;
      expect(lane?.options).toEqual(options);
      await lane?.handle(created("owner-3"), { tenantId: "project-1", aggregateId: "owner-3" });

      expect(handle).toHaveBeenCalledWith(
        { ownerId: "owner-3" },
        {
          tenantId: "project-1",
          aggregateId: "owner-3",
          occurredAt: 1,
          eventId: "event-owner-3",
        },
      );
    });
  });
});
