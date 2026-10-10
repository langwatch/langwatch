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
});

const ORGANIZATION = createTenantId("organization-1");
const STREAM = { aggregateType: "sso_connection", aggregateId: "connection-1" } as const;

/** One stored row of a stream, at a time that orders it. */
function streamRecord({
  eventId,
  at,
  tenantId = ORGANIZATION,
  aggregateType = STREAM.aggregateType,
}: {
  eventId: string;
  at: number;
  tenantId?: string;
  aggregateType?: string;
}) {
  return {
    TenantId: tenantId,
    AggregateType: aggregateType,
    AggregateId: STREAM.aggregateId,
    EventId: eventId,
    EventTimestamp: at,
    EventOccurredAt: at,
    EventType: "lw.identity.connection_registered",
    EventVersion: "2026-01-01",
    EventPayload: { step: eventId },
    ProcessingTraceparent: "",
    IdempotencyKey: eventId,
  };
}

/** A seat over a memory log holding the given rows. */
async function seatOver(records: ReturnType<typeof streamRecord>[]) {
  const repository = EventRepositoryMemory.createForTesting();
  await repository.insertEventRecords(records);
  return EventLogReadSeat.create({ repository });
}

describe("EventLogReadSeat stream reads", () => {
  describe("given an aggregate holding three events in one tenant's stream", () => {
    /** @scenario "An aggregate's events are answered oldest first" */
    it("answers them oldest first with their data", async () => {
      const seat = await seatOver([
        streamRecord({ eventId: "evt-1", at: 1_000 }),
        streamRecord({ eventId: "evt-2", at: 2_000 }),
        streamRecord({ eventId: "evt-3", at: 3_000 }),
      ]);

      const events = await seat.getEvents({ tenantId: ORGANIZATION, ...STREAM });

      expect(events.map((event) => event.id)).toEqual(["evt-1", "evt-2", "evt-3"]);
      expect(events[0]).toMatchObject({ occurredAt: 1_000, data: { step: "evt-1" } });
    });
  });

  describe("given a tenant whose stream holds no event for the aggregate", () => {
    /** @scenario "An aggregate nothing happened to answers no events" */
    it("answers no events", async () => {
      const seat = await seatOver([]);

      await expect(seat.getEvents({ tenantId: ORGANIZATION, ...STREAM })).resolves.toEqual([]);
    });
  });

  describe("given an aggregate holding events in one tenant's stream", () => {
    /** @scenario "Another tenant's stream is never answered" */
    it("answers another tenant nothing", async () => {
      const seat = await seatOver([streamRecord({ eventId: "evt-1", at: 1_000 })]);

      await expect(
        seat.getEvents({ tenantId: createTenantId("organization-2"), ...STREAM }),
      ).resolves.toEqual([]);
    });
  });

  describe("given two aggregate types under the same tenant and aggregate id", () => {
    /** @scenario "Another aggregate type under the same id is never answered" */
    it("answers only the asked aggregate type's events", async () => {
      const seat = await seatOver([
        streamRecord({ eventId: "evt-own", at: 1_000 }),
        streamRecord({ eventId: "evt-other", at: 2_000, aggregateType: "scim_sync" }),
      ]);

      const events = await seat.getEvents({ tenantId: ORGANIZATION, ...STREAM });

      expect(events.map((event) => event.id)).toEqual(["evt-own"]);
    });
  });

  describe("when the aggregate id is empty", () => {
    /** @scenario "A stream read without an aggregate id is refused" */
    it("refuses as invalid", async () => {
      const seat = await seatOver([]);

      await expect(
        seat.getEvents({
          tenantId: ORGANIZATION,
          aggregateType: "sso_connection",
          aggregateId: " ",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
