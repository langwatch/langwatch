/**
 * @vitest-environment node
 * A stored type read through the runtime's read seat answers as the current one.
 * @see packages/eventing/specs/event-read-seat.feature
 */
import { generate } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventLogReadSeat } from "../eventReadSeat.ts";
import { EventStoreMemory } from "../eventStoreMemory.ts";
import { EventRepositoryMemory } from "../repositories/eventRepositoryMemory.ts";

const STORED = "lw.usage.month_counted";
const CURRENT = "lw.entitlement.month_counted";
const TENANT = createTenantId("organization-1");

function entitlementPipeline({ data }: { data?: (stored: unknown) => unknown } = {}) {
  return definePipeline({
    name: "entitlement",
    aggregate: defineAggregate({ type: "entitlement_organization" }),
  })
    .withEvents([
      testEventSchema(
        CURRENT,
        z.object({ organizationId: z.string(), billableEvents: z.number() }),
      ),
    ])
    .withUpcasts({
      events: [
        {
          from: { type: STORED, aggregateType: "usage_organization" },
          to: CURRENT,
          data:
            data ??
            ((stored) => {
              const { organizationId, count } = z
                .object({ organizationId: z.string(), count: z.number() })
                .parse(stored);
              return { organizationId, billableEvents: count };
            }),
        },
      ],
    })
    .build();
}

/** A runtime whose read seat sits over a log holding one event as a previous release stored it. */
async function runtimeHoldingStoredEvent({
  pipeline = entitlementPipeline(),
}: { pipeline?: ReturnType<typeof entitlementPipeline> } = {}) {
  const repository = EventRepositoryMemory.createForTesting();
  const eventId = generate("event").toString();
  const now = Date.now();
  await repository.insertEventRecords([
    {
      TenantId: TENANT,
      AggregateType: "usage_organization",
      AggregateId: "organization-1",
      EventId: eventId,
      EventTimestamp: now,
      EventOccurredAt: now,
      EventType: STORED,
      EventVersion: "2026-10-06",
      EventPayload: { organizationId: "organization-1", count: 12 },
      ProcessingTraceparent: "",
      IdempotencyKey: eventId,
    },
  ]);
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    eventReadSeat: EventLogReadSeat.create({ repository }),
  });
  // Registered after the seat is composed, as every process registers its pipelines.
  eventing.register(pipeline);
  return { eventing, eventId };
}

describe("EventSourcing's read seat", () => {
  describe("when the log holds an event under a type its pipeline now upcasts", () => {
    /** @scenario "A stored type is read through the seat as the current type" */
    it("answers the stream and the event under the current type, aggregate type and data", async () => {
      const { eventing, eventId } = await runtimeHoldingStoredEvent();
      const seat = eventing.eventReadSeat;
      const current = {
        id: eventId,
        type: CURRENT,
        aggregateType: "entitlement_organization",
        data: { organizationId: "organization-1", billableEvents: 12 },
      };

      const stream = await seat?.findAggregateEvents({
        tenantId: TENANT,
        aggregateType: "entitlement_organization",
        aggregateId: "organization-1",
      });
      const one = await seat?.getEvent({
        tenantId: TENANT,
        aggregateType: "entitlement_organization",
        aggregateId: "organization-1",
        eventId,
      });

      expect(stream).toEqual([expect.objectContaining(current)]);
      expect(one).toMatchObject(current);
    });
  });

  describe("when an upcast yields a payload the current schema refuses", () => {
    /** @scenario "An upcast that yields an invalid current event fails the seat read" */
    it("rejects the stream read and the event read", async () => {
      const { eventing, eventId } = await runtimeHoldingStoredEvent({
        pipeline: entitlementPipeline({
          data: () => ({ organizationId: "organization-1", billableEvents: "twelve" }),
        }),
      });
      const seat = eventing.eventReadSeat;
      const where = {
        tenantId: TENANT,
        aggregateType: "entitlement_organization",
        aggregateId: "organization-1",
      };

      const refusals = await Promise.all([
        seat?.findAggregateEvents(where).catch((error: unknown) => error),
        seat?.getEvent({ ...where, eventId }).catch((error: unknown) => error),
      ]);

      // Both reads surface the schema's refusal of `billableEvents`, not a "not found".
      for (const refusal of refusals) {
        expect(refusal).toBeInstanceOf(ZodError);
        expect((refusal as ZodError).issues[0]?.path).toEqual(["data", "billableEvents"]);
      }
    });
  });
});
