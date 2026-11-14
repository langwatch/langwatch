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

type Read = EventingClickHouseClient["read"];

/** Records each built statement and answers with one stored row. */
function recordingClient(eventId: string) {
  const statements: Parameters<Read>[0]["statement"][] = [];
  const read: Read = async ({ statement }) => {
    statements.push(statement);
    // Rows arrive untyped, as the driver's JSON does, until the caller names its row.
    return {
      rows: JSON.parse(
        JSON.stringify([
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
        ]),
      ),
    };
  };
  const client: EventingClickHouseClient = { read, insert: async () => undefined };
  return { client, statements };
}

describe("EventLogReadSeat over the ClickHouse event log", () => {
  describe("when asked for an event whose id is a KSUID", () => {
    /** @scenario "The event log read is bounded to seven days either side of the id's time" */
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
      expect(statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
      expect(statement?.sql).toContain(
        "FROM event_log WHERE TenantId = {tenantId:String} AND (AggregateType = {v0:String}",
      );
      expect(statement?.sql).toContain("AggregateId = {v1:String} AND EventId = {v2:String}");
      expect(statement?.sql).toContain(
        "(EventOccurredAt = {v3:UInt64} OR (EventOccurredAt >= {v4:UInt64} AND EventOccurredAt <= {v5:UInt64}))",
      );
      expect(statement?.params).toEqual({
        tenantId: "project-1",
        v0: "trace",
        v1: "trace-1",
        v2: eventId,
        v3: 0,
        v4: idTimeMs - EVENT_READ_WINDOW_MS,
        v5: idTimeMs + EVENT_READ_WINDOW_MS,
      });
    });
  });
});
