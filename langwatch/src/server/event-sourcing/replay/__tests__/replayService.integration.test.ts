import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../__tests__/integration/testContainers";
import { generateTestTenantId } from "../../__tests__/integration/testHelpers";
import { ReplayService } from "../replayService";
import type { RegisteredMapProjection } from "../types";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types";
import { CUTOFF_KEY_PREFIX, COMPLETED_KEY_PREFIX } from "../replayConstants";
import { aggregateKey } from "../replayMarkers";

describe("ReplayService tenant-specific ClickHouse", () => {
  let tenantA: string;
  let tenantB: string;
  let client: ClickHouseClient;
  const resolverCalls: string[] = [];

  beforeAll(async () => {
    await startTestContainers();
    client = getTestClickHouseClient()!;
    tenantA = generateTestTenantId();
    tenantB = generateTestTenantId();

    // Insert events for tenant A
    await client.insert({
      table: "event_log",
      values: [
        {
          TenantId: tenantA,
          AggregateType: "trace",
          AggregateId: "trace-a1",
          EventId: "evt-a-001",
          EventType: "trace.upserted",
          EventTimestamp: 1700000000000,
          EventOccurredAt: 1700000000000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 1 }),
        },
        {
          TenantId: tenantA,
          AggregateType: "trace",
          AggregateId: "trace-a2",
          EventId: "evt-a-002",
          EventType: "trace.upserted",
          EventTimestamp: 1700000001000,
          EventOccurredAt: 1700000001000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 2 }),
        },
      ],
      format: "JSONEachRow",
    });

    // Insert events for tenant B (different tenant, different aggregates)
    await client.insert({
      table: "event_log",
      values: [
        {
          TenantId: tenantB,
          AggregateType: "trace",
          AggregateId: "trace-b1",
          EventId: "evt-b-001",
          EventType: "trace.upserted",
          EventTimestamp: 1700000002000,
          EventOccurredAt: 1700000002000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 100 }),
        },
      ],
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    if (client) {
      await client.exec({
        query: `ALTER TABLE event_log DELETE WHERE TenantId IN ({tenantA:String}, {tenantB:String})`,
        query_params: { tenantA, tenantB },
      });
    }
    await stopTestContainers();
  });

  function createServiceWithResolver() {
    resolverCalls.length = 0;
    const redis = getTestRedisConnection()!;

    const service = new ReplayService({
      clickhouseClientResolver: async (tenantId: string) => {
        resolverCalls.push(tenantId);
        // In production, different tenants may resolve to different CH instances.
        // Here we return the same client but track which tenant IDs were requested.
        return client;
      },
      redis,
    });

    return service;
  }

  describe("discover", () => {
    it("resolves CH client per tenant during discovery", async () => {
      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      expect(resultA.aggregates).toHaveLength(2);
      expect(resultA.aggregates.every((a) => a.tenantId === tenantA)).toBe(true);
      expect(resolverCalls).toContain(tenantA);
    });

    it("isolates discovery results between tenants", async () => {
      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      const resultB = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantB,
      });

      // Tenant A has 2 aggregates, tenant B has 1
      expect(resultA.aggregates).toHaveLength(2);
      expect(resultB.aggregates).toHaveLength(1);

      // No cross-tenant leakage
      expect(resultA.aggregates.every((a) => a.tenantId === tenantA)).toBe(true);
      expect(resultB.aggregates.every((a) => a.tenantId === tenantB)).toBe(true);

      // Resolver was called with both tenant IDs
      expect(resolverCalls).toContain(tenantA);
      expect(resolverCalls).toContain(tenantB);
    });
  });

  describe("when discovering without tenant filter", () => {
    it("discovers aggregates across all tenants", async () => {
      const service = createServiceWithResolver();

      const result = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        // no tenantId — discovers across all
      });

      expect(result.aggregates.length).toBeGreaterThanOrEqual(3);
      expect(result.byTenant.has(tenantA)).toBe(true);
      expect(result.byTenant.has(tenantB)).toBe(true);
    });
  });

  describe("when tenants share the same aggregateId", () => {
    it("keeps them as separate aggregates", async () => {
      // Insert an event for tenant B with the same aggregate ID as tenant A
      await client.insert({
        table: "event_log",
        values: [
          {
            TenantId: tenantB,
            AggregateType: "trace",
            AggregateId: "trace-a1", // same as tenant A's aggregate!
            EventId: "evt-b-clash-001",
            EventType: "trace.upserted",
            EventTimestamp: 1700000003000,
            EventOccurredAt: 1700000003000,
            EventVersion: "2025-01-01",
            EventPayload: JSON.stringify({ value: 999 }),
          },
        ],
        format: "JSONEachRow",
      });

      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      const resultB = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          kind: "fold",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantB,
      });

      // Tenant A still sees only its own aggregates
      expect(resultA.aggregates).toHaveLength(2);
      // Tenant B now has trace-b1 + trace-a1 (shared ID, different tenant)
      expect(resultB.aggregates).toHaveLength(2);
      expect(resultB.aggregates.map((a) => a.aggregateId).sort()).toEqual(["trace-a1", "trace-b1"]);
    });
  });

  describe("replay map projection", () => {
    function createMapProjection({
      name,
      bulkAppend,
      append,
    }: {
      name: string;
      bulkAppend?: ReturnType<typeof vi.fn>;
      append?: ReturnType<typeof vi.fn>;
    }): RegisteredMapProjection {
      const pipelineName = "test_pipeline";
      const definition: MapProjectionDefinition<{ doubled: number; src: string }, any> = {
        name,
        eventTypes: ["trace.upserted"],
        map: (event: any) => ({
          doubled: ((event.data?.value as number | undefined) ?? 0) * 2,
          src: event.aggregateId,
        }),
        store: {
          append: append ?? vi.fn().mockResolvedValue(undefined),
          ...(bulkAppend ? { bulkAppend } : {}),
        },
      };
      return {
        projectionName: name,
        pipelineName,
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `${pipelineName}/handler/${name}`,
        kind: "map",
        definition,
      };
    }

    it("drains, marks cutoffs, bulk-appends mapped records, and cleans markers", async () => {
      const redis = getTestRedisConnection()!;
      const projectionName = `mapReplayHappy_${Date.now()}`;
      const pausedSetKey = "{event-sourcing/jobs}:gq:paused-jobs";

      // Capture whether the pause-set entry is active at the moment records
      // are flushed. The replay batch must keep the projection paused through
      // the WRITE phase and only unpause in the UNMARK step that follows.
      let pausedDuringWrite: number | null = null;
      const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
        pausedDuringWrite = await redis.sismember(
          pausedSetKey,
          `test_pipeline/handler/${projectionName}`,
        );
      });

      const projection = createMapProjection({ name: projectionName, bulkAppend });
      const service = createServiceWithResolver();

      const result = await service.replay({
        projections: [],
        mapProjections: [projection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(2);
      expect(result.totalEvents).toBe(2);

      // Records flushed via bulkAppend grouped by aggregate (one call per agg).
      expect(bulkAppend).toHaveBeenCalledTimes(2);
      const appendedRecords = bulkAppend.mock.calls.flatMap(([records]) => records as any[]);
      expect(appendedRecords.map((r) => r.src).sort()).toEqual(["trace-a1", "trace-a2"]);
      expect(appendedRecords.map((r) => r.doubled).sort((a, b) => a - b)).toEqual([2, 4]);

      // Each bulkAppend call must carry the per-aggregate context (not a
      // shared/generic context), so the store can route records correctly.
      for (const [records, ctx] of bulkAppend.mock.calls as Array<[any[], any]>) {
        expect(ctx.tenantId).toBe(tenantA);
        expect(records.every((r) => r.src === ctx.aggregateId)).toBe(true);
      }

      // Pause was held active while records were being written.
      expect(pausedDuringWrite).toBe(1);

      // Pause cleared on success.
      const stillPaused = await redis.sismember(
        pausedSetKey,
        `test_pipeline/handler/${projectionName}`,
      );
      expect(stillPaused).toBe(0);

      // Final cleanupAll removed both replay marker keys.
      const cutoffLeft = await redis.exists(`${CUTOFF_KEY_PREFIX}${projectionName}`);
      const completedLeft = await redis.exists(`${COMPLETED_KEY_PREFIX}${projectionName}`);
      expect(cutoffLeft).toBe(0);
      expect(completedLeft).toBe(0);
    });

    it("skips aggregates already in the completed set on resume", async () => {
      const redis = getTestRedisConnection()!;
      const projectionName = `mapReplayResume_${Date.now()}`;

      // Pre-populate the completed set to simulate an earlier partial run that
      // finished trace-a1 before being interrupted.
      const completedAggKey = aggregateKey({
        tenantId: tenantA,
        aggregateType: "trace",
        aggregateId: "trace-a1",
      });
      await redis.sadd(`${COMPLETED_KEY_PREFIX}${projectionName}`, completedAggKey);

      const bulkAppend = vi.fn().mockResolvedValue(undefined);
      const projection = createMapProjection({ name: projectionName, bulkAppend });
      const service = createServiceWithResolver();

      const result = await service.replay({
        projections: [],
        mapProjections: [projection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      // Only trace-a2 was processed; trace-a1 was skipped via the completed set.
      expect(result.totalEvents).toBe(1);

      expect(bulkAppend).toHaveBeenCalledTimes(1);
      const appendedRecords = bulkAppend.mock.calls.flatMap(([records]) => records as any[]);
      expect(appendedRecords.map((r) => r.src)).toEqual(["trace-a2"]);

      // cleanupAll ran — both keys gone, including the pre-populated completed set.
      const completedLeft = await redis.exists(`${COMPLETED_KEY_PREFIX}${projectionName}`);
      const cutoffLeft = await redis.exists(`${CUTOFF_KEY_PREFIX}${projectionName}`);
      expect(completedLeft).toBe(0);
      expect(cutoffLeft).toBe(0);
    });

  });
});
