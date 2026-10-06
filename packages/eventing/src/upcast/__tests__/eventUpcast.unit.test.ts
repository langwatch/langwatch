/**
 * @vitest-environment node
 * The real case, on a fixture pipeline: stored `lw.usage.*` reads as `lw.entitlement.*`.
 * Spec: packages/eventing/specs/event-upcast.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { sealPipelineDefinition } from "../../pipeline/sealedPipeline.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type {
  CutoffInfo,
  DiscoveredAggregateWithEventTypes,
  ReplayEvent,
  ReplayEventSource,
} from "../../replay/replayEventSource.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import { EventUpcaster, type UpcastDeclaration } from "../eventUpcast.ts";
import { EventUpcastReader } from "../eventUpcastReader.ts";
import { upcastEventStore } from "../upcastEventStore.ts";
import { pipelineUpcastsOf, upcastReplayEventSource } from "../upcastReplayEventSource.ts";

const STORED = "lw.usage.month_counted";
const CURRENT = "lw.entitlement.month_counted";
const monthCountedSchema = testEventSchema(
  CURRENT,
  z.object({ organizationId: z.string(), billableEvents: z.number() }),
);
const legacyData = z.looseObject({ organizationId: z.string(), count: z.number() });
const TENANT = createTenantId("organization-1");

const renamed: UpcastDeclaration<typeof CURRENT> = {
  events: [{ from: { type: STORED, aggregateType: "usage_organization" }, to: CURRENT }],
  drain: { pipeline: "usage" },
};

function entitlementPipeline({
  upcasts = renamed,
  seen = vi.fn(),
}: { upcasts?: UpcastDeclaration<typeof CURRENT>; seen?: (event: Event) => void } = {}) {
  return definePipeline({
    name: "entitlement",
    aggregate: defineAggregate({ type: "entitlement_organization" }),
  })
    .withEvents([monthCountedSchema])
    .withUpcasts(upcasts)
    .withEventSubscriber("monthCounted", {
      events: [CURRENT],
      handler: async (event: Event) => seen(event),
    })
    .build();
}

function stored({
  id,
  type = STORED,
  aggregateType = "usage_organization",
  aggregateId = "organization-1",
  createdAt = 1,
  data = { organizationId: "organization-1", billableEvents: 7 },
}: {
  id: string;
  type?: string;
  aggregateType?: string;
  aggregateId?: string;
  createdAt?: number;
  data?: unknown;
}): Event {
  return {
    id,
    aggregateId,
    aggregateType,
    tenantId: TENANT,
    type,
    version: "2026-10-06",
    createdAt,
    occurredAt: createdAt,
    data,
  };
}

/** Sends a job as a previous release queued it, under the registry key it names. */
async function sendQueued({
  eventSourcing,
  event,
  pipeline,
}: {
  eventSourcing: EventSourcing;
  event: Event;
  pipeline: string;
}): Promise<void> {
  const key = [...eventSourcing.globalJobRegistry.keys()].find(
    (name) => name.startsWith("entitlement:") && name.endsWith(":monthCounted"),
  );
  const [, jobType, jobName] = (key ?? "").split(":");
  await eventSourcing.globalQueue?.send({
    ...event,
    __pipelineName: pipeline,
    __jobType: jobType,
    __jobName: jobName,
  });
}

function runtimeWith(seen: (event: Event) => void, upcasts?: UpcastDeclaration<typeof CURRENT>) {
  const eventSourcing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  eventSourcing.register(entitlementPipeline({ seen, upcasts }));
  return eventSourcing;
}

/** A replay source over a fixed log, answering only the event types it is asked for. */
class FixedReplaySource implements ReplayEventSource {
  constructor(private readonly log: readonly ReplayEvent[]) {}

  #matching(eventTypes: readonly string[]): ReplayEvent[] {
    return this.log.filter((event) => eventTypes.includes(event.type));
  }

  async discoverAffectedAggregates({
    eventTypes,
  }: {
    eventTypes: readonly string[];
  }): Promise<DiscoveredAggregateWithEventTypes[]> {
    return this.#matching(eventTypes).map((event) => ({
      tenantId: event.tenantId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventTypes: [event.type],
    }));
  }

  async countEventsForAggregates({ eventTypes }: { eventTypes: readonly string[] }) {
    return this.#matching(eventTypes).length;
  }

  /** The latest (timestamp, id) per stored aggregate key, as the ClickHouse source answers. */
  async getBoundedCutoffs({
    aggregateTypes,
    eventTypes,
  }: {
    aggregateTypes: string[];
    eventTypes: readonly string[];
  }) {
    const cutoffs = new Map<string, CutoffInfo>();
    for (const event of this.#matching(eventTypes)) {
      if (!aggregateTypes.includes(event.aggregateType)) continue;
      const key = `${event.tenantId}:${event.aggregateType}:${event.aggregateId}`;
      const known = cutoffs.get(key);
      if (known && known.timestamp >= event.timestamp) continue;
      cutoffs.set(key, { timestamp: event.timestamp, eventId: event.id });
    }
    return { cutoffs, occurredAtBounds: undefined };
  }

  async streamEventsForAggregates({
    eventTypes,
    onEvent,
  }: {
    eventTypes: readonly string[];
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }) {
    const events = this.#matching(eventTypes);
    for (const event of events) await onEvent(event);
    return { eventsApplied: events.length };
  }

  async loadAggregateEvents({ eventTypes }: { eventTypes: readonly string[] }) {
    return this.#matching(eventTypes);
  }
}

function replayed(
  id: string,
  {
    timestamp = 1,
    ...overrides
  }: Partial<Parameters<typeof stored>[0]> & { timestamp?: number } = {},
): ReplayEvent {
  return {
    ...stored({ id, ...overrides }),
    tenantId: "organization-1",
    timestamp,
    idempotencyKey: id,
  };
}

describe("an upcast declared on the owning pipeline", () => {
  describe("when the worker dispatches a queued job carrying the stored type", () => {
    /** @scenario "A queued job carrying the stored type is dispatched as the current type" */
    it("hands the subscriber the current type on the current aggregate", async () => {
      const seen = vi.fn();
      const eventSourcing = runtimeWith(seen);

      await sendQueued({ eventSourcing, event: stored({ id: "e1" }), pipeline: "entitlement" });

      await vi.waitFor(() =>
        expect(seen).toHaveBeenCalledWith(
          expect.objectContaining({ type: CURRENT, aggregateType: "entitlement_organization" }),
        ),
      );
      await eventSourcing.close();
    });

    /** @scenario "Jobs queued under the former pipeline's keys drain into the current lanes" */
    it("drains a job queued under the former pipeline's key into the current lane", async () => {
      const seen = vi.fn();
      const eventSourcing = runtimeWith(seen);

      await sendQueued({ eventSourcing, event: stored({ id: "e2" }), pipeline: "usage" });

      await vi.waitFor(() =>
        expect(seen).toHaveBeenCalledWith(expect.objectContaining({ id: "e2", type: CURRENT })),
      );
      await eventSourcing.close();
    });

    /** @scenario "A transform that throws refuses the event by name and is not retried" */
    it("refuses the job as an invalid queued payload naming the payload field", async () => {
      const eventSourcing = runtimeWith(vi.fn(), {
        events: [
          {
            from: { type: STORED },
            to: CURRENT,
            data: () => {
              throw new Error("no count");
            },
          },
        ],
      });

      await expect(
        sendQueued({ eventSourcing, event: stored({ id: "e3" }), pipeline: "entitlement" }),
      ).rejects.toMatchObject({
        name: "QueuedPayloadInvalidError",
        issues: [expect.objectContaining({ path: "data", code: "undeclared" })],
      });
      await eventSourcing.close();
    });

    /** @scenario "A stored type no upcast names is still refused as undeclared" */
    it("refuses a type neither declared nor upcast", async () => {
      const eventSourcing = runtimeWith(vi.fn());

      await expect(
        sendQueued({
          eventSourcing,
          event: stored({ id: "e4", type: "lw.usage.limit_reached" }),
          pipeline: "entitlement",
        }),
      ).rejects.toMatchObject({
        name: "QueuedPayloadInvalidError",
        issues: [expect.objectContaining({ path: "type" })],
      });
      await eventSourcing.close();
    });
  });

  describe("when the pipeline reads its aggregate's history", () => {
    /** @scenario "An event-store read of the aggregate answers the current type" */
    it("answers every event once, as the current type, in log order", async () => {
      const store = EventStoreMemory.createForTesting();
      const context = { tenantId: TENANT };
      await store.storeEvents([stored({ id: "e1", createdAt: 1 })], context, "usage_organization");
      await store.storeEvents(
        [
          stored({
            id: "e2",
            type: CURRENT,
            aggregateType: "entitlement_organization",
            createdAt: 2,
          }),
          stored({
            id: "e1",
            type: CURRENT,
            aggregateType: "entitlement_organization",
            createdAt: 1,
          }),
        ],
        context,
        "entitlement_organization",
      );
      await store.storeEvents([stored({ id: "e0", createdAt: 0 })], context, "usage_organization");
      const definition = entitlementPipeline();
      const upcasting = upcastEventStore({
        store,
        upcaster: EventUpcaster.of(definition.upcasts),
        parseEvent: definition.parseEvent,
      });

      const events = await upcasting.getEvents({
        aggregateId: "organization-1",
        context,
        aggregateType: "entitlement_organization",
      });

      expect(events.map((event) => [event.id, event.type, event.aggregateType])).toEqual([
        ["e0", CURRENT, "entitlement_organization"],
        ["e1", CURRENT, "entitlement_organization"],
        ["e2", CURRENT, "entitlement_organization"],
      ]);
    });

    /** @scenario "A payload transform reshapes the stored data before the current schema parses it" */
    it("parses the transformed payload with the current schema", async () => {
      const definition = entitlementPipeline({
        upcasts: {
          events: [
            {
              from: { type: STORED },
              to: CURRENT,
              data: (data) => {
                const legacy = legacyData.parse(data);
                return { organizationId: legacy.organizationId, billableEvents: legacy.count };
              },
            },
          ],
        },
      });

      const parsed = definition.parseEvent(
        stored({ id: "e5", data: { organizationId: "organization-1", count: 12 } }),
      );

      expect(parsed).toMatchObject({ type: CURRENT, data: { billableEvents: 12 } });
    });
  });

  describe("when a projection replay discovers and streams its aggregates", () => {
    /** @scenario "A projection replay discovers and reads stored events as the current type" */
    it("finds the stored type's aggregates and streams them as the current type", async () => {
      const source = upcastReplayEventSource({
        source: new FixedReplaySource([replayed("r1"), replayed("r2")]),
        upcasts: pipelineUpcastsOf([sealPipelineDefinition(entitlementPipeline())]),
      });
      const streamed: ReplayEvent[] = [];

      const aggregates = await source.discoverAffectedAggregates({
        eventTypes: [CURRENT],
        sinceMs: 0,
      });
      await source.streamEventsForAggregates({
        tenantId: "organization-1",
        aggregateIds: ["organization-1"],
        eventTypes: [CURRENT],
        cutoffs: new Map(),
        onEvent: (event) => {
          streamed.push(event);
        },
      });

      expect(aggregates).toEqual([
        expect.objectContaining({
          aggregateType: "entitlement_organization",
          aggregateId: "organization-1",
          eventTypes: [CURRENT],
        }),
      ]);
      expect(streamed.map((event) => event.type)).toEqual([CURRENT, CURRENT]);
    });
  });

  describe("when a projection replay asks for the cutoffs of the current aggregate type", () => {
    /** @scenario "A projection replay of a renamed aggregate finds its cutoffs under the current aggregate type" */
    it("answers each stored aggregate's cutoff under the current type, keeping the later one", async () => {
      const current = { type: CURRENT, aggregateType: "entitlement_organization" };
      const source = upcastReplayEventSource({
        source: new FixedReplaySource([
          replayed("a-stored", { aggregateId: "org-a", timestamp: 5 }),
          replayed("b-stored", { aggregateId: "org-b", timestamp: 9 }),
          replayed("b-current", { aggregateId: "org-b", timestamp: 4, ...current }),
          replayed("c-stored", { aggregateId: "org-c", timestamp: 2 }),
          replayed("c-current", { aggregateId: "org-c", timestamp: 6, ...current }),
        ]),
        upcasts: pipelineUpcastsOf([sealPipelineDefinition(entitlementPipeline())]),
      });

      const { cutoffs } = await source.getBoundedCutoffs({
        tenantId: "organization-1",
        aggregateTypes: ["entitlement_organization"],
        aggregateIds: ["org-a", "org-b", "org-c"],
        eventTypes: [CURRENT],
      });

      expect(cutoffs.get("organization-1:entitlement_organization:org-a")).toEqual({
        timestamp: 5,
        eventId: "a-stored",
      });
      expect(cutoffs.get("organization-1:entitlement_organization:org-b")).toEqual({
        timestamp: 9,
        eventId: "b-stored",
      });
      expect(cutoffs.get("organization-1:entitlement_organization:org-c")).toEqual({
        timestamp: 6,
        eventId: "c-current",
      });
      expect(cutoffs.get("organization-1:usage_organization:org-a")).toEqual({
        timestamp: 5,
        eventId: "a-stored",
      });
    });
  });

  describe("when the pipeline is built", () => {
    /** @scenario "An upcast to an undeclared type is refused when the pipeline is built" */
    it("refuses an upcast to a type its events do not declare", () => {
      const undeclared = { events: [{ from: { type: STORED }, to: "lw.entitlement.other" }] };

      expect(() =>
        definePipeline({ name: "entitlement", aggregate: defineAggregate({ type: "x" }) })
          .withEvents([monthCountedSchema])
          // @ts-expect-error -- the declared events type `to`; the runtime refuses it too
          .withUpcasts(undeclared),
      ).toThrow(/lw\.entitlement\.other/);
    });

    /** @scenario "An upcast from a type the pipeline still declares is refused when the pipeline is built" */
    it("refuses an upcast from one of its current types", () => {
      expect(() =>
        entitlementPipeline({ upcasts: { events: [{ from: { type: CURRENT }, to: CURRENT }] } }),
      ).toThrow(/still declares/);
    });
  });

  describe("when ops reads the active upcasts", () => {
    /** @scenario "Ops reads each active upcast and the stored events it covers" */
    it("reads each upcast with the stored events it covers", async () => {
      const reader = EventUpcastReader.create({
        upcasts: pipelineUpcastsOf([sealPipelineDefinition(entitlementPipeline())]),
        coverage: new FixedReplaySource([replayed("r1"), replayed("r2"), replayed("r3")]),
      });

      await expect(reader.findActiveUpcasts()).resolves.toEqual([
        {
          id: "upcast:entitlement:lw.usage.month_counted",
          pipeline: "entitlement",
          from: STORED,
          fromAggregateType: "usage_organization",
          to: CURRENT,
          drainsFrom: "usage",
          storedEvents: 3,
        },
      ]);
    });
  });
});
