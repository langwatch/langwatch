/** Spec: packages/eventing/specs/projection-replay.feature */
import {
  type ClickHouseEventRow,
  EventingClickHouseReplayEventSource,
  type EventingClickHouseReplayClient,
} from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";

const row = (eventId: string, timestamp: number): ClickHouseEventRow => ({
  TenantId: "project_a",
  AggregateType: "trace",
  AggregateId: "trace_1",
  EventId: eventId,
  EventType: "lw.span.received",
  EventTimestamp: timestamp,
  EventOccurredAt: timestamp,
  EventVersion: "2025-12-14",
  EventPayload: "{}",
});

/** The routed member's surface, answering nothing unless a test scripts it. */
function member() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    stream: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
  };
  const clickhouse: EventingClickHouseReplayClient = client;
  return {
    client,
    source: new EventingClickHouseReplayEventSource({ clickhouse, lean: (e) => e }),
  };
}

describe("EventingClickHouseReplayEventSource", () => {
  describe("when a batch's events are read", () => {
    /** @scenario "A replay batch reads its events streamed rather than held whole" */
    it("applies each streamed batch as it arrives, from the batch's tenant", async () => {
      const { client, source } = member();
      client.stream.mockImplementation(async function* () {
        yield [row("event_1", 1), row("event_2", 2)];
        yield [row("event_3", 3)];
      });
      const applied: string[] = [];

      const { eventsApplied } = await source.streamEventsForAggregates({
        tenantId: "project_a",
        aggregateIds: ["trace_1"],
        eventTypes: ["lw.span.received"],
        cutoffs: new Map(),
        onEvent: (event) => {
          applied.push(event.id);
        },
      });

      expect(applied).toEqual(["event_1", "event_2", "event_3"]);
      expect(eventsApplied).toBe(3);
      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project_a" }),
      );
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("when a replay is asked for every tenant", () => {
    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names no tenant and gives its reason, so the member reads the shared server", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "", unscoped: expect.anything() }),
      );
    });

    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names the tenant when the replay was asked for one", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({
        eventTypes: ["lw.span.received"],
        sinceMs: 0,
        tenantId: "project_a",
      });

      expect(client.query).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "project_a" }));
    });
  });

  describe("when a rebuilt table is optimized", () => {
    /** @scenario "A rebuilt table is optimized on each touched tenant's own server" */
    it("names the tenant, so a private data plane's table is the one optimized", async () => {
      const { client, source } = member();

      await source.optimizeTables("project_a", ["stored_spans"]);

      expect(client.command).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project_a", params: { table: "stored_spans" } }),
      );
    });
  });
});
