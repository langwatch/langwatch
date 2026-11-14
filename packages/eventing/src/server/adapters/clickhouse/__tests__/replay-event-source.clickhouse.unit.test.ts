/** Spec: packages/eventing/specs/projection-replay.feature */
import {
  type ClickHouseEventRow,
  EventingClickHouseReplayEventSource,
  type EventingClickHouseReplayClient,
  getAggregateOccurredAtBounds,
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

const SCOPED_TO_PROJECT_A = {
  identity: "reader",
  kind: "tenant",
  tenantId: "project_a",
  settings: expect.objectContaining({ SQL_langwatch_tenant_ids: "project_a" }),
};

/** The built statement of the read'th call the member received. */
const sentAt = (client: { read: ReturnType<typeof vi.fn> }, call: number) => {
  const [request] = client.read.mock.calls[call] ?? [];
  if (!request) throw new Error(`no read at call ${call}`);
  return request as { statement: { sql: string; identity: string; kind: string } };
};

/** The routed member's surface, answering nothing unless a test scripts it. */
function member() {
  const client = {
    read: vi.fn().mockResolvedValue({ rows: [] }),
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
      expect(client.read).not.toHaveBeenCalled();
    });
  });

  describe("when a replay is asked for every tenant", () => {
    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names no tenant and gives its reason, so the member reads the shared server", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      // The member sends an all-tenants statement to the shared server on the system identity.
      expect(client.read).toHaveBeenCalledWith({
        statement: expect.objectContaining({
          identity: "system",
          kind: "allTenants",
          reason: expect.stringContaining("ops_projection_replay"),
        }),
        declaresFullScan: true,
      });
    });

    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names the tenant when the replay was asked for one", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({
        eventTypes: ["lw.span.received"],
        sinceMs: 0,
        tenantId: "project_a",
      });

      expect(client.read).toHaveBeenCalledWith(
        expect.objectContaining({ statement: expect.objectContaining(SCOPED_TO_PROJECT_A) }),
      );
    });
  });

  describe("when a batch's occurred-at bounds are read", () => {
    /** @scenario "Replay's bounds read over a batch's aggregates is a declared full scan" */
    it("declares a full scan, since later reads in the batch prune by its answer", async () => {
      const { client } = member();

      await getAggregateOccurredAtBounds({
        client,
        tenantId: "project_a",
        aggregateTypes: ["trace"],
        aggregateIds: ["trace_1"],
      });

      expect(client.read).toHaveBeenCalledWith({
        statement: expect.objectContaining(SCOPED_TO_PROJECT_A),
        declaresFullScan: true,
      });
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

  describe("given each read a replay batch makes of one tenant", () => {
    it("sends every one on the reader identity, scoped to that tenant alone", async () => {
      const { client, source } = member();
      client.read.mockResolvedValue({ rows: [{ cnt: 1, minOccurredAt: 5, maxOccurredAt: 9 }] });
      const batch = { tenantId: "project_a", eventTypes: ["lw.span.received"] };

      await source.countEventsForAggregates({ ...batch, sinceMs: 0 });
      await source.getBoundedCutoffs({ ...batch, aggregateTypes: ["trace"], aggregateIds: ["t1"] });
      await source.loadAggregateEvents({
        ...batch,
        aggregateIds: ["t1"],
        maxCutoff: { timestamp: 9, eventId: "e9" },
        cursor: { timestamp: 2, eventId: "e2" },
        batchSize: 100,
        occurredAtBounds: { minMs: 5, maxMs: 9 },
      });

      expect(client.read).toHaveBeenCalledTimes(4);
      for (let call = 0; call < 4; call++) {
        expect(sentAt(client, call).statement).toMatchObject(SCOPED_TO_PROJECT_A);
        expect(sentAt(client, call).statement.sql).toContain(
          "FROM event_log WHERE TenantId = {tenantId:String}",
        );
      }
      expect(sentAt(client, 0).statement.sql).toMatch(
        /^WITH discovered AS \(SELECT tuple\(AggregateType, AggregateId\) AS aggregateKey FROM event_log WHERE TenantId = \{tenantId:String\}/,
      );
      expect(sentAt(client, 0).statement.sql).toMatch(
        /tuple\(AggregateType, AggregateId\) IN discovered/,
      );
      expect(sentAt(client, 2).statement.sql).toContain(
        "argMax(EventId, tuple(EventTimestamp, EventId)) AS cutoffEventId",
      );
      expect(sentAt(client, 3).statement.sql).toMatch(
        /ORDER BY EventTimestamp ASC, EventId ASC LIMIT 100$/,
      );
    });
  });

  describe("given a replay listing or counting every tenant", () => {
    it("sends the tenant list and the count as all-tenants statements with their reason", async () => {
      const { client, source } = member();

      await source.discoverTenants({ eventTypes: ["lw.span.received"], sinceMs: 0 });
      await source.countEventsForAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      for (let call = 0; call < 2; call++) {
        expect(sentAt(client, call).statement).toMatchObject({
          identity: "system",
          kind: "allTenants",
        });
        expect(sentAt(client, call).statement.sql).not.toContain("{tenantId:String}");
      }
      expect(sentAt(client, 0).statement.sql).toMatch(
        /^SELECT DISTINCT TenantId AS tenantId FROM event_log/,
      );
    });
  });
});
