/**
 * @see packages/eventing/specs/event-read-seat.feature
 */
import { generate, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId.ts";
import { EventNotFoundError, ValidationError } from "../../services/errorHandling.ts";
import { EVENT_READ_WINDOW_MS, EventLogReadSeat } from "../eventReadSeat.ts";
import { EventRepositoryMemory } from "../repositories/eventRepositoryMemory.ts";

const TENANT = createTenantId("project-1");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A seat over a memory log holding one event, recorded at a time derived from its id's. */
async function seatHolding({
  eventId = generate("event").toString(),
  occurredAt,
}: {
  eventId?: string;
  occurredAt: (idTimeMs: number) => number | null;
}) {
  const repository = EventRepositoryMemory.createForTesting();
  const idTimeMs = idTime(eventId);
  await repository.insertEventRecords([
    {
      TenantId: TENANT,
      AggregateType: "trace",
      AggregateId: "trace-1",
      EventId: eventId,
      EventTimestamp: idTimeMs,
      EventOccurredAt: occurredAt(idTimeMs),
      EventType: "lw.obs.trace.span_received",
      EventVersion: "2025-12-14",
      EventPayload: { body: "the whole log line" },
      ProcessingTraceparent: "",
      IdempotencyKey: eventId,
    },
  ]);
  return { seat: EventLogReadSeat.create({ repository }), eventId };
}

/** The time a KSUID id carries, or a fixed time for an id that carries none. */
function idTime(eventId: string): number {
  try {
    return Ksuid.parse(eventId).date.getTime();
  } catch {
    return 1_700_000_000_000;
  }
}

function read(seat: EventLogReadSeat, eventId: string, tenantId = TENANT) {
  return seat.getEvent({ tenantId, aggregateType: "trace", aggregateId: "trace-1", eventId });
}

describe("EventLogReadSeat", () => {
  describe("given an event recorded within two days of its id's time", () => {
    /** @scenario "An event inside the window is answered" */
    it("answers the event with its data", async () => {
      const { seat, eventId } = await seatHolding({ occurredAt: (t) => t - DAY_MS });

      await expect(read(seat, eventId)).resolves.toMatchObject({
        id: eventId,
        data: { body: "the whole log line" },
      });
    });
  });

  describe("given an event recorded more than two days from its id's time", () => {
    /** @scenario "An event recorded outside the window is not found" */
    it("fails as not found", async () => {
      const { seat, eventId } = await seatHolding({
        occurredAt: (t) => t + EVENT_READ_WINDOW_MS + DAY_MS,
      });

      await expect(read(seat, eventId)).rejects.toBeInstanceOf(EventNotFoundError);
    });
  });

  describe("given an event stored with no occurred time", () => {
    /** @scenario "An event with no recorded time is always answered" */
    it("answers it", async () => {
      const { seat, eventId } = await seatHolding({ occurredAt: () => null });

      await expect(read(seat, eventId)).resolves.toMatchObject({ id: eventId });
    });
  });

  describe("given an id that is not a KSUID", () => {
    /** @scenario "An id that carries no time is read without a window" */
    it("answers the event whatever its occurred time", async () => {
      const { seat, eventId } = await seatHolding({
        eventId: "not-a-ksuid",
        occurredAt: () => 1,
      });

      await expect(read(seat, eventId)).resolves.toMatchObject({ id: "not-a-ksuid" });
    });
  });

  describe("given an event in one tenant's stream", () => {
    /** @scenario "Another tenant's event is never answered" */
    it("fails as not found for another tenant", async () => {
      const { seat, eventId } = await seatHolding({ occurredAt: (t) => t });

      await expect(read(seat, eventId, createTenantId("project-2"))).rejects.toBeInstanceOf(
        EventNotFoundError,
      );
    });
  });

  describe("when the id or the aggregate id is empty", () => {
    /** @scenario "A read without an event id or stream is refused" */
    it("refuses as invalid", async () => {
      const { seat, eventId } = await seatHolding({ occurredAt: (t) => t });

      await expect(read(seat, " ")).rejects.toBeInstanceOf(ValidationError);
      await expect(
        seat.getEvent({ tenantId: TENANT, aggregateType: "trace", aggregateId: "", eventId }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("when one aggregate's whole stream is asked", () => {
    async function streamSeat() {
      const { seat, eventId } = await seatHolding({ occurredAt: (t) => t - 30 * DAY_MS });
      return { seat, eventId };
    }

    /** @scenario "One aggregate's stream is answered whole, whatever its age" */
    it("answers every event of that stream, outside the one-event window too", async () => {
      const { seat, eventId } = await streamSeat();

      const events = await seat.findAggregateEvents({
        tenantId: TENANT,
        aggregateType: "trace",
        aggregateId: "trace-1",
      });

      expect(events.map((event) => event.id)).toEqual([eventId]);
    });

    /** @scenario "Another tenant's stream answers nothing" */
    it("answers nothing for another tenant or an empty aggregate id", async () => {
      const { seat } = await streamSeat();

      await expect(
        seat.findAggregateEvents({
          tenantId: createTenantId("project-2"),
          aggregateType: "trace",
          aggregateId: "trace-1",
        }),
      ).resolves.toEqual([]);
      await expect(
        seat.findAggregateEvents({ tenantId: TENANT, aggregateType: "trace", aggregateId: " " }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a page of streams is asked in one read", () => {
    /** Two streams in two tenants, the first holding two events recorded out of order. */
    async function pageSeat() {
      const repository = EventRepositoryMemory.createForTesting();
      const record = ({
        tenantId,
        aggregateId,
        eventId,
        at,
      }: {
        tenantId: string;
        aggregateId: string;
        eventId: string;
        at: number;
      }) => ({
        TenantId: tenantId,
        AggregateType: "user",
        AggregateId: aggregateId,
        EventId: eventId,
        EventTimestamp: at,
        EventOccurredAt: at,
        EventType: "lw.user.deactivated",
        EventVersion: "2025-12-14",
        EventPayload: { at },
        ProcessingTraceparent: "",
        IdempotencyKey: eventId,
      });
      await repository.insertEventRecords([
        record({ tenantId: "user_sam", aggregateId: "user_sam", eventId: "evt_2", at: 20 }),
        record({ tenantId: "user_sam", aggregateId: "user_sam", eventId: "evt_1", at: 10 }),
        record({ tenantId: "user_ana", aggregateId: "user_ana", eventId: "evt_3", at: 30 }),
      ]);
      return EventLogReadSeat.create({ repository });
    }

    /** @scenario "A page of streams is answered in one read, each stream oldest first" */
    it("answers every asked stream, each oldest first, in its own tenant", async () => {
      const seat = await pageSeat();

      const events = await seat.findEventsOfAggregates({
        aggregateType: "user",
        aggregates: [
          { tenantId: createTenantId("user_sam"), aggregateId: "user_sam" },
          { tenantId: createTenantId("user_ana"), aggregateId: "user_ana" },
        ],
      });

      const idsOf = (aggregateId: string) =>
        events.filter((event) => event.aggregateId === aggregateId).map((event) => event.id);
      expect(idsOf("user_sam")).toEqual(["evt_1", "evt_2"]);
      expect(idsOf("user_ana")).toEqual(["evt_3"]);
    });

    /** @scenario "A page of streams answers nothing for a stream asked in another tenant" */
    it("answers nothing for a stream asked under another tenant or with an empty id", async () => {
      const seat = await pageSeat();

      await expect(
        seat.findEventsOfAggregates({
          aggregateType: "user",
          aggregates: [
            { tenantId: createTenantId("user_ana"), aggregateId: "user_sam" },
            { tenantId: TENANT, aggregateId: " " },
          ],
        }),
      ).resolves.toEqual([]);
    });
  });
});
