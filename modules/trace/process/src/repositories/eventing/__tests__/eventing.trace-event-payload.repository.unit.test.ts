/**
 * @vitest-environment node
 * Trace's offloaded-field read over eventing's one-event seat, and the memory tier's twin.
 */
import { type Event, EventNotFoundError, type EventReadSeat } from "@langwatch/eventing";
import { instantiateRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { traceRepositories } from "../../trace-repositories.registry.ts";
import {
  EventingTraceEventPayloadRepository,
  TraceEventPayloadFieldNotFoundError,
} from "../eventing.trace-event-payload.repository.ts";

type SeatRead = Parameters<EventReadSeat["getEvent"]>[0];

/** A seat answering one event's data, or not found, and keeping every read it was asked. */
class RecordingSeat implements EventReadSeat {
  readonly reads: SeatRead[] = [];

  constructor(private readonly data: unknown) {}

  async getEvent(input: SeatRead): Promise<Event> {
    this.reads.push(input);
    if (this.data === undefined) throw new EventNotFoundError(input);

    return { id: input.eventId, data: this.data } as Event;
  }
}

const FULL_INPUT = "x".repeat(70_000);

const recall = (seat: RecordingSeat, field = "langwatch.input") =>
  EventingTraceEventPayloadRepository.create({ eventReadSeat: seat }).read({
    tenantId: "project-1",
    traceId: "trace-1",
    eventId: "event-1",
    field,
  });

describe("given a span attribute offloaded under an event of trace trace-1", () => {
  describe("when the trace read recalls that field", () => {
    /** @scenario "An offloaded field is read whole from its own trace event" */
    it("asks the seat for the tenant's trace event and serves the full value", async () => {
      const seat = new RecordingSeat({
        span: { attributes: [{ key: "langwatch.input", value: { stringValue: FULL_INPUT } }] },
      });

      await expect(recall(seat)).resolves.toBe(FULL_INPUT);
      expect(seat.reads).toEqual([
        {
          tenantId: "project-1",
          aggregateType: "trace",
          aggregateId: "trace-1",
          eventId: "event-1",
        },
      ]);
    });

    /** @scenario "A malformed sibling attribute cannot mask the offloaded field" */
    it("returns the offloaded value past a numeric sibling attribute", async () => {
      const seat = new RecordingSeat({
        span: {
          attributes: [
            { key: "llm.tokens", value: { intValue: 42 } },
            { key: "langwatch.input", value: { stringValue: FULL_INPUT } },
          ],
        },
      });

      await expect(recall(seat)).resolves.toBe(FULL_INPUT);
    });
  });
});

describe("given a log record whose body was offloaded", () => {
  /** @scenario "A log record's body is recalled from the top of the payload" */
  it("reads it from the payload root rather than from span attributes", async () => {
    await expect(recall(new RecordingSeat({ body: FULL_INPUT }), "body")).resolves.toBe(FULL_INPUT);
  });
});

describe("given the field cannot be served", () => {
  /** @scenario "An event the seat cannot answer keeps the preview" */
  it("raises the seat's not-found when the event is outside its window", async () => {
    await expect(recall(new RecordingSeat(undefined))).rejects.toBeInstanceOf(EventNotFoundError);
  });

  /** @scenario "Absence answers null rather than raising at the read port" */
  it("raises field-not-found when the event carries no such field", async () => {
    await expect(recall(new RecordingSeat({ span: { attributes: [] } }))).rejects.toBeInstanceOf(
      TraceEventPayloadFieldNotFoundError,
    );
  });
});

describe("given the trace repositories selected on the memory tier", () => {
  /** @scenario "A process on memory stores keeps the preview" */
  it("raises on every recall, so the caller serves the preview", async () => {
    const { eventPayloads } = instantiateRepositories(traceRepositories, {
      tier: "memory",
      members: {},
    });

    await expect(
      eventPayloads.read({
        tenantId: "project-1",
        traceId: "trace-1",
        eventId: "event-1",
        field: "langwatch.input",
      }),
    ).rejects.toThrow("the memory trace repositories hold no offloaded payloads");
  });
});
