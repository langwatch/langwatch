/**
 * @see packages/eventing/specs/event-read-seat.feature
 */
import { createTenantId, EVENT_READ_WINDOW_MS, EventLogReadSeat } from "@langwatch/eventing";
import {
  EventingClickHouseEventRepository,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { generate, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

/** Records each statement and answers with one stored row. */
function recordingClient(eventId: string) {
  const statements: { query: string; query_params?: Record<string, unknown> }[] = [];
  const client: EventingClickHouseClient = {
    query: async (request) => {
      statements.push(request);
      return {
        json: async <Row>() =>
          [
            {
              EventId: eventId,
              EventTimestamp: 1,
              EventOccurredAt: 1,
              EventType: "lw.obs.trace.span_received",
              EventPayload: "{}",
              EventVersion: "2025-12-14",
              ProcessingTraceparent: "",
              IdempotencyKey: eventId,
            },
          ] as Row[],
      };
    },
    insert: async () => undefined,
  };
  return { client, statements };
}

describe("EventLogReadSeat over the ClickHouse event log", () => {
  describe("when asked for an event whose id is a KSUID", () => {
    /** @scenario "The event log read is bounded to two days either side of the id's time" */
    it("names the tenant first and keeps unknown and in-window occurred times", async () => {
      const eventId = generate("event").toString();
      const idTimeMs = Ksuid.parse(eventId).date.getTime();
      const { client, statements } = recordingClient(eventId);
      const seat = EventLogReadSeat.create({
        repository: EventingClickHouseEventRepository.createForEventReads({
          resolveClient: async () => client,
        }),
      });

      await seat.getEvent({
        tenantId: createTenantId("project-1"),
        aggregateType: "trace",
        aggregateId: "trace-1",
        eventId,
      });

      const [statement] = statements;
      const where = statement!.query.replace(/\s+/g, " ");
      expect(where).toMatch(/WHERE TenantId = \{tenantId:String\} AND AggregateType/);
      expect(where).toContain(
        "AND AggregateId = {aggregateId:String} AND EventId = {eventId:String}",
      );
      expect(where).toContain(
        "EventOccurredAt = 0 OR ( EventOccurredAt >= {occurredAtFromMs:UInt64} AND EventOccurredAt <= {occurredAtToMs:UInt64} )",
      );
      expect(statement!.query_params).toEqual({
        tenantId: "project-1",
        aggregateType: "trace",
        aggregateId: "trace-1",
        eventId,
        occurredAtFromMs: idTimeMs - EVENT_READ_WINDOW_MS,
        occurredAtToMs: idTimeMs + EVENT_READ_WINDOW_MS,
      });
    });
  });
});
