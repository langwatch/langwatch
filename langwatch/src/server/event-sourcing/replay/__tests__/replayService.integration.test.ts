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
import type { RegisteredFoldProjection, RegisteredMapProjection } from "../types";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types";
import { CUTOFF_KEY_PREFIX, COMPLETED_KEY_PREFIX, doneMarkerKey } from "../replayConstants";
import { aggregateKey } from "../replayMarkers";
import { RedisReplayMarkerChecker } from "../../projections/replayMarkerCheck";

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
          // Backdated fixture timestamp (Nov 2023). Stamp the never-expire
          // sentinel so the platform retention TTL doesn't delete the row
          // on the next merge — DEFAULT 308 on the column would TTL it.
          _retention_days: 0,
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
          _retention_days: 0,
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
          _retention_days: 0,
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
            _retention_days: 0,
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
          definition: { name: "test", version: "v1", LastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
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
    type MapRecord = { doubled: number; src: string };
    type AppendFn = MapProjectionDefinition<MapRecord, any>["store"]["append"];
    type BulkAppendFn = NonNullable<MapProjectionDefinition<MapRecord, any>["store"]["bulkAppend"]>;

    function createMapProjection({
      name,
      bulkAppend,
      append,
    }: {
      name: string;
      bulkAppend?: BulkAppendFn;
      append?: AppendFn;
    }): RegisteredMapProjection {
      const pipelineName = "test_pipeline";
      const definition: MapProjectionDefinition<MapRecord, any> = {
        name,
        eventTypes: ["trace.upserted"],
        map: (event: any) => ({
          doubled: ((event.data?.value as number | undefined) ?? 0) * 2,
          src: event.aggregateId,
        }),
        store: {
          append: append ?? (async () => undefined),
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

      // Records flushed via ONE tenant-scoped bulkAppend covering both
      // aggregates — never one awaited call per aggregate (that per-trace
      // grouping is what made span-storage replays take weeks).
      expect(bulkAppend).toHaveBeenCalledTimes(1);
      const appendedRecords = bulkAppend.mock.calls.flatMap(([records]) => records as any[]);
      expect(appendedRecords.map((r) => r.src).sort()).toEqual(["trace-a1", "trace-a2"]);
      expect(appendedRecords.map((r) => r.doubled).sort((a, b) => a - b)).toEqual([2, 4]);

      // The bulk call carries the tenant-scoped context.
      for (const [, ctx] of bulkAppend.mock.calls as Array<[any[], any]>) {
        expect(ctx.tenantId).toBe(tenantA);
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

    it("waits for an active custom-key map job to drain before writing", async () => {
      const redis = getTestRedisConnection()!;
      const projectionName = `mapReplayDrain_${Date.now()}`;

      // Live map jobs are grouped by the projection's custom groupKeyFn (e.g.
      // `span:${event.id}`), not by `${aggregateType}:${aggregateId}` — the
      // drain must detect those keys by prefix, not by reconstruction.
      const activeCustomKeyGroup = `{event-sourcing/jobs}:gq:group:${tenantA}/map/${projectionName}/span:evt-live-1:active`;
      await redis.set(activeCustomKeyGroup, "1");

      let bulkAppendCalledWhileJobActive = false;
      let jobStillActive = true;
      const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
        if (jobStillActive) bulkAppendCalledWhileJobActive = true;
      });

      const projection = createMapProjection({ name: projectionName, bulkAppend });
      const service = createServiceWithResolver();

      const replayPromise = service.replay({
        projections: [],
        mapProjections: [projection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      // Give the replay time to reach (and sit in) the drain poll loop.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(bulkAppend).not.toHaveBeenCalled();

      // Simulate the in-flight handler finishing.
      jobStillActive = false;
      await redis.del(activeCustomKeyGroup);

      const result = await replayPromise;
      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(2);
      expect(bulkAppend).toHaveBeenCalled();
      expect(bulkAppendCalledWhileJobActive).toBe(false);
    });

    it("runs both fold and map projections in the same replay, isolating pause-set entries", async () => {
      const redis = getTestRedisConnection()!;
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const foldName = `mixedFold_${suffix}`;
      const mapName = `mixedMap_${suffix}`;
      const pausedSetKey = "{event-sourcing/jobs}:gq:paused-jobs";
      const foldPauseKey = `test_pipeline/projection/${foldName}`;
      const mapPauseKey = `test_pipeline/handler/${mapName}`;

      // Capture the pause-set membership of each projection at WRITE time. The
      // map's `bulkAppend` runs inside `replayMapBatch.write`, which fires only
      // after the fold loop has finished and unpaused itself; so the fold should
      // already be back in the live set by then. The fold's `store.store` runs
      // inside its own batch's WRITE phase, while it's still paused.
      let foldPausedAtWrite: number | null = null;
      let mapPausedAtFoldWrite: number | null = null;
      let mapPausedAtBulkAppend: number | null = null;
      let foldPausedAtBulkAppend: number | null = null;

      const foldStore = vi.fn(async (_state: { count: number }, _ctx: any) => {
        foldPausedAtWrite = await redis.sismember(pausedSetKey, foldPauseKey);
        mapPausedAtFoldWrite = await redis.sismember(pausedSetKey, mapPauseKey);
      });

      const foldDefinition: FoldProjectionDefinition<{ count: number }, any> = {
        name: foldName,
        version: "v1",
        eventTypes: ["trace.upserted"],
        LastEventOccurredAtKey: "LastEventOccurredAt",
        init: () => ({ count: 0 }),
        apply: (state) => ({ count: state.count + 1 }),
        store: {
          store: foldStore,
          get: vi.fn().mockResolvedValue(null),
        },
      };
      const foldProjection: RegisteredFoldProjection = {
        projectionName: foldName,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: foldPauseKey,
        kind: "fold",
        definition: foldDefinition,
      };

      const bulkAppend = vi.fn(async (_records: { src: string }[], _ctx: any) => {
        mapPausedAtBulkAppend = await redis.sismember(pausedSetKey, mapPauseKey);
        foldPausedAtBulkAppend = await redis.sismember(pausedSetKey, foldPauseKey);
      });
      const mapDefinition: MapProjectionDefinition<{ src: string }, any> = {
        name: mapName,
        eventTypes: ["trace.upserted"],
        map: (event: any) => ({ src: event.aggregateId }),
        store: {
          append: async () => undefined,
          bulkAppend,
        },
      };
      const mapProjection: RegisteredMapProjection = {
        projectionName: mapName,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: mapPauseKey,
        kind: "map",
        definition: mapDefinition,
      };

      const service = createServiceWithResolver();

      const result = await service.replay({
        projections: [foldProjection],
        mapProjections: [mapProjection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      // 2 aggregates × 2 projections.
      expect(result.aggregatesReplayed).toBe(4);
      // 2 events folded + 2 events mapped.
      expect(result.totalEvents).toBe(4);

      // Fold persisted both aggregate states.
      expect(foldStore).toHaveBeenCalledTimes(2);
      const foldedAggregates = foldStore.mock.calls
        .map((c) => (c[1] as any).aggregateId)
        .sort();
      expect(foldedAggregates).toEqual(["trace-a1", "trace-a2"]);

      // Map bulk-appended both aggregates in a single tenant-scoped call.
      expect(bulkAppend).toHaveBeenCalledTimes(1);
      for (const [records, ctx] of bulkAppend.mock.calls as Array<[any[], any]>) {
        expect(ctx.tenantId).toBe(tenantA);
        expect((records as { src: string }[]).map((r) => r.src).sort()).toEqual([
          "trace-a1",
          "trace-a2",
        ]);
      }

      // Fold projection was paused while its own WRITE phase ran. The map's
      // pauseKey is independent — `replay()` pauses each projection only for
      // its own batch, not for the whole replay session.
      expect(foldPausedAtWrite).toBe(1);
      // While the fold was writing, the map projection had not been paused yet.
      expect(mapPausedAtFoldWrite).toBe(0);

      // When the map's bulkAppend fires, the fold loop is long done and
      // unpaused; only the map should be in the pause set.
      expect(mapPausedAtBulkAppend).toBe(1);
      expect(foldPausedAtBulkAppend).toBe(0);

      // Both projections unpaused on success.
      expect(await redis.sismember(pausedSetKey, foldPauseKey)).toBe(0);
      expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);

      // Markers cleaned for both projections.
      for (const name of [foldName, mapName]) {
        expect(await redis.exists(`${CUTOFF_KEY_PREFIX}${name}`)).toBe(0);
        expect(await redis.exists(`${COMPLETED_KEY_PREFIX}${name}`)).toBe(0);
      }
    });

    it("skips the map projection when an earlier fold projection batch fails", async () => {
      const redis = getTestRedisConnection()!;
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const foldName = `failingFold_${suffix}`;
      const mapName = `unrunMap_${suffix}`;
      const pausedSetKey = "{event-sourcing/jobs}:gq:paused-jobs";
      const foldPauseKey = `test_pipeline/projection/${foldName}`;
      const mapPauseKey = `test_pipeline/handler/${mapName}`;

      // Capture the cutoff hash mid-write so the `toEqual({})` assertion at
      // the end can't pass vacuously — the markers must exist BEFORE the
      // failure and be cleared BY the failure path, not never written at all.
      let foldCutoffsAtFailure: Record<string, string> | null = null;
      const foldStore = vi.fn(async (_state: { count: number }, _ctx: any) => {
        foldCutoffsAtFailure = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${foldName}`);
        throw new Error("fold store boom");
      });

      const foldDefinition: FoldProjectionDefinition<{ count: number }, any> = {
        name: foldName,
        version: "v1",
        eventTypes: ["trace.upserted"],
        LastEventOccurredAtKey: "LastEventOccurredAt",
        init: () => ({ count: 0 }),
        apply: (state) => ({ count: state.count + 1 }),
        store: {
          store: foldStore,
          get: vi.fn().mockResolvedValue(null),
        },
      };
      const foldProjection: RegisteredFoldProjection = {
        projectionName: foldName,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: foldPauseKey,
        kind: "fold",
        definition: foldDefinition,
      };

      const bulkAppend = vi.fn().mockResolvedValue(undefined);
      const mapDefinition: MapProjectionDefinition<{ src: string }, any> = {
        name: mapName,
        eventTypes: ["trace.upserted"],
        map: (event: any) => ({ src: event.aggregateId }),
        store: {
          append: async () => undefined,
          bulkAppend,
        },
      };
      const mapProjection: RegisteredMapProjection = {
        projectionName: mapName,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: mapPauseKey,
        kind: "map",
        definition: mapDefinition,
      };

      const service = createServiceWithResolver();

      const result = await service.replay({
        projections: [foldProjection],
        mapProjections: [mapProjection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      // Fold batch surfaced an error and the outer loop short-circuited.
      expect(result.batchErrors).toBeGreaterThan(0);
      expect(result.firstError).toMatch(/fold store boom/);

      // The map projection must NOT have run — `replay()` guards the map loop
      // behind `if (totalBatchErrors === 0)`. Without this guard, a partial
      // fold write would be followed by map writes that assume the fold
      // succeeded.
      expect(bulkAppend).not.toHaveBeenCalled();

      // Map's pause key was never added to the pause set (it never got far
      // enough to be paused).
      expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);

      // Fold projection was unpaused by the error path in `replayProjection`.
      expect(await redis.sismember(pausedSetKey, foldPauseKey)).toBe(0);

      // The cutoff markers were live at the moment the write failed...
      expect(foldCutoffsAtFailure).not.toBeNull();
      expect(Object.keys(foldCutoffsAtFailure!)).not.toHaveLength(0);

      // ...and the failed batch's pending/cutoff markers were cleared too —
      // live events for its aggregates process normally right away instead of
      // deferring until the marker TTL lapses.
      expect(await redis.hgetall(`${CUTOFF_KEY_PREFIX}${foldName}`)).toEqual({});
    });

    it("clears the failed batch's markers and unpauses when a map projection batch fails", async () => {
      const redis = getTestRedisConnection()!;
      const projectionName = `mapReplayFail_${Date.now()}`;
      const pausedSetKey = "{event-sourcing/jobs}:gq:paused-jobs";
      const mapPauseKey = `test_pipeline/handler/${projectionName}`;

      // Capture the cutoff hash mid-write so the `toEqual({})` assertion at
      // the end can't pass vacuously — the markers must exist BEFORE the
      // failure and be cleared BY the failure path, not never written at all.
      let cutoffsAtFailure: Record<string, string> | null = null;
      const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
        cutoffsAtFailure = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${projectionName}`);
        throw new Error("bulk write boom");
      });

      const projection = createMapProjection({ name: projectionName, bulkAppend });
      const service = createServiceWithResolver();

      const result = await service.replay({
        projections: [],
        mapProjections: [projection],
        tenantIds: [tenantA],
        since: "2023-11-01",
      });

      // The map batch surfaced the write error instead of throwing.
      expect(result.batchErrors).toBeGreaterThan(0);
      expect(result.firstError).toMatch(/bulk write boom/);

      // Both aggregates carried live cutoff markers at the moment the
      // write failed...
      expect(cutoffsAtFailure).not.toBeNull();
      const expectedAggKeys = ["trace-a1", "trace-a2"].map((id) =>
        aggregateKey({ tenantId: tenantA, aggregateType: "trace", aggregateId: id }),
      );
      expect(Object.keys(cutoffsAtFailure!).sort()).toEqual(expectedAggKeys.sort());

      // ...and the failure path cleared them, so live events for the failed
      // batch's aggregates process normally right away instead of deferring
      // until the marker TTL lapses.
      expect(await redis.hgetall(`${CUTOFF_KEY_PREFIX}${projectionName}`)).toEqual({});

      // The catch unpauses BEFORE its final emit — the pause-set entry (a
      // no-TTL set member) must be gone so live processing is never left
      // frozen by a failed batch.
      expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);
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

  describe("replayOptimized per-eventType projection mapping", () => {
    function createFoldProjection({ name, store }: { name: string; store: any }): RegisteredFoldProjection {
      const definition: FoldProjectionDefinition<{ count: number }, any> = {
        name,
        version: "v1",
        eventTypes: ["trace.upserted"],
        LastEventOccurredAtKey: "LastEventOccurredAt",
        init: () => ({ count: 0 }),
        apply: (state) => ({ count: state.count + 1 }),
        store,
      };
      return {
        projectionName: name,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `test_pipeline/projection/${name}`,
        kind: "fold",
        definition,
      };
    }

    function createSpanMapProjection({ name, bulkAppend }: { name: string; bulkAppend: any }): RegisteredMapProjection {
      const definition: MapProjectionDefinition<{ src: string }, any> = {
        name,
        eventTypes: ["span.created"],
        map: (event: any) => ({ src: event.aggregateId }),
        store: { append: async () => undefined, bulkAppend },
      };
      return {
        projectionName: name,
        pipelineName: "test_pipeline",
        aggregateType: "span",
        source: "pipeline",
        pauseKey: `test_pipeline/handler/${name}`,
        kind: "map",
        definition,
      };
    }

    it("does not mark aggregates for projections whose event types they lack", async () => {
      const redis = getTestRedisConnection()!;
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const foldName = `optFold_${suffix}`;
      const mapName = `optMap_${suffix}`;

      // A span-only aggregate: matches the map projection's event types but
      // shares none with the fold projection.
      await client.insert({
        table: "event_log",
        values: [
          {
            TenantId: tenantA,
            AggregateType: "span",
            AggregateId: `span-s1-${suffix}`,
            EventId: "evt-span-001",
            EventType: "span.created",
            EventTimestamp: 1700000004000,
            EventOccurredAt: 1700000004000,
            EventVersion: "2025-01-01",
            EventPayload: JSON.stringify({ value: 7 }),
            // Backdated timestamp — without the never-expire sentinel the
            // platform retention TTL (applied to the shared test DB by the
            // ttlReconciler) drops the freshly inserted part immediately,
            // making the map projection discover nothing.
            _retention_days: 0,
          },
        ],
        format: "JSONEachRow",
      });

      // Discovery must see the freshly inserted event — poll until ClickHouse
      // reports it visible (insert visibility is not synchronous on CI).
      for (let attempt = 0; attempt < 50; attempt++) {
        const visible = await client.query({
          query: `SELECT count() AS c FROM event_log WHERE TenantId = {tenantId:String} AND AggregateId = {aggregateId:String}`,
          query_params: { tenantId: tenantA, aggregateId: `span-s1-${suffix}` },
          format: "JSONEachRow",
        });
        const [row] = (await visible.json()) as Array<{ c: string }>;
        if (Number(row?.c) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const spanAggKey = aggregateKey({
        tenantId: tenantA,
        aggregateType: "span",
        aggregateId: `span-s1-${suffix}`,
      });
      const traceAggKeys = ["trace-a1", "trace-a2"].map((id) =>
        aggregateKey({ tenantId: tenantA, aggregateType: "trace", aggregateId: id }),
      );

      // Capture marker state at WRITE time (markers are cleaned at run end).
      let foldCutoffsAtWrite: Record<string, string> | null = null;
      let mapCutoffsAtWrite: Record<string, string> | null = null;
      const foldStore = vi.fn(async (_state: { count: number }, _ctx: any) => {
        foldCutoffsAtWrite = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${foldName}`);
        mapCutoffsAtWrite = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
      });
      const bulkAppend = vi.fn().mockResolvedValue(undefined);

      const foldProjection = createFoldProjection({
        name: foldName,
        store: { store: foldStore, get: vi.fn().mockResolvedValue(null) },
      });
      const mapProjection = createSpanMapProjection({ name: mapName, bulkAppend });

      const service = createServiceWithResolver();
      const batchKinds: string[] = [];

      const result = await service.replayOptimized(
        {
          projections: [foldProjection],
          mapProjections: [mapProjection],
          tenantIds: [tenantA],
          since: "2023-11-01",
        },
        { onBatchComplete: (info) => batchKinds.push(info.projectionKind) },
      );

      expect(result.batchErrors).toBe(0);

      // Fold wrote both trace aggregates; map wrote only the span aggregate.
      expect(foldStore).toHaveBeenCalledTimes(2);
      expect(bulkAppend).toHaveBeenCalledTimes(1);
      expect(bulkAppend.mock.calls[0]![0]).toEqual([{ src: `span-s1-${suffix}` }]);

      // The fold projection's cutoff markers cover only its own aggregates —
      // the span-only aggregate never appears, and vice versa for the map.
      expect(foldCutoffsAtWrite).not.toBeNull();
      expect(Object.keys(foldCutoffsAtWrite!).sort()).toEqual(traceAggKeys.sort());
      expect(Object.keys(mapCutoffsAtWrite!)).toEqual([spanAggKey]);

      // Mixed fold+map runs report the dominant kind.
      expect(batchKinds).toEqual(["fold"]);
    });

    it("reports projectionKind map for map-only optimized runs", async () => {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const mapName = `optMapOnly_${suffix}`;
      const bulkAppend = vi.fn().mockResolvedValue(undefined);
      const mapProjection: RegisteredMapProjection = {
        projectionName: mapName,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `test_pipeline/handler/${mapName}`,
        kind: "map",
        definition: {
          name: mapName,
          eventTypes: ["trace.upserted"],
          map: (event: any) => ({ src: event.aggregateId }),
          store: { append: async () => undefined, bulkAppend },
        },
      };

      const service = createServiceWithResolver();
      const batchKinds: string[] = [];
      const progressKinds = new Set<string>();

      const result = await service.replayOptimized(
        {
          projections: [],
          mapProjections: [mapProjection],
          tenantIds: [tenantA],
          since: "2023-11-01",
        },
        {
          onBatchComplete: (info) => batchKinds.push(info.projectionKind),
          onProgress: (progress) => progressKinds.add(progress.currentProjectionKind),
        },
      );

      expect(result.batchErrors).toBe(0);
      expect(bulkAppend).toHaveBeenCalled();
      expect(batchKinds).toEqual(["map"]);
      expect([...progressKinds]).toEqual(["map"]);
    });
  });

  describe("replayOptimized batch pause windows and failed-batch marker cleanup", () => {
    const pausedSetKey = "{event-sourcing/jobs}:gq:paused-jobs";

    function createTrackedMapProjection({
      name,
      bulkAppend,
    }: {
      name: string;
      bulkAppend: any;
    }): RegisteredMapProjection {
      return {
        projectionName: name,
        pipelineName: "test_pipeline",
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `test_pipeline/handler/${name}`,
        kind: "map",
        definition: {
          name,
          eventTypes: ["trace.upserted"],
          map: (event: any) => ({ src: event.aggregateId }),
          store: { append: async () => undefined, bulkAppend },
        },
      };
    }

    describe("when a replay spans multiple batches", () => {
      it("pauses only while a batch is replayed and resumes between batches", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optBatchPause_${suffix}`;
        const mapPauseKey = `test_pipeline/handler/${mapName}`;

        const pausedDuringWrite: number[] = [];
        const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
          pausedDuringWrite.push(await redis.sismember(pausedSetKey, mapPauseKey));
        });
        const projection = createTrackedMapProjection({ name: mapName, bulkAppend });
        const service = createServiceWithResolver();

        const pausedAtBatchComplete: number[] = [];
        const pendingChecks: Promise<void>[] = [];

        // aggregateBatchSize 1 with tenant A's two trace aggregates → 2 batches.
        const result = await service.replayOptimized(
          {
            projections: [],
            mapProjections: [projection],
            tenantIds: [tenantA],
            since: "2023-11-01",
            aggregateBatchSize: 1,
          },
          {
            onBatchComplete: () => {
              // The sismember is issued synchronously here (same Redis
              // connection, ordered before the next batch's re-pause) but
              // resolves async — collect it so assertions wait for it.
              pendingChecks.push(
                redis.sismember(pausedSetKey, mapPauseKey).then((paused) => {
                  pausedAtBatchComplete.push(paused);
                }),
              );
            },
          },
        );
        await Promise.all(pendingChecks);

        expect(result.batchErrors).toBe(0);
        expect(result.aggregatesReplayed).toBe(2);

        // One flush per batch — pause held while each batch's records land.
        expect(bulkAppend).toHaveBeenCalledTimes(2);
        expect(pausedDuringWrite).toEqual([1, 1]);

        // Between batches (onBatchComplete fires after the batch's finally
        // unpauses), live processing is running again — the freeze is
        // per-batch, never for the whole run.
        expect(pausedAtBatchComplete).toEqual([0, 0]);

        // Unpaused at the end too.
        expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);
      });
    });

    describe("when a batch fails", () => {
      it("unpauses the projections instead of leaving live processing frozen", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optBatchFail_${suffix}`;
        const mapPauseKey = `test_pipeline/handler/${mapName}`;

        const bulkAppend = vi.fn(async () => {
          throw new Error("bulk write boom");
        });
        const projection = createTrackedMapProjection({ name: mapName, bulkAppend });
        const service = createServiceWithResolver();

        const result = await service.replayOptimized({
          projections: [],
          mapProjections: [projection],
          tenantIds: [tenantA],
          since: "2023-11-01",
        });

        expect(result.batchErrors).toBeGreaterThan(0);
        expect(result.firstError).toMatch(/bulk write boom/);

        // The per-batch finally unpaused despite the failure.
        expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);
      });

      it("clears the failed batch's replay markers so live events process normally right away", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optBatchFailMarkers_${suffix}`;

        // Capture the cutoff hash mid-write so the `toEqual({})` assertion
        // below can't pass vacuously — the markers must exist BEFORE the
        // failure and be cleared BY the failure path.
        let cutoffsAtFailure: Record<string, string> | null = null;
        const bulkAppend = vi.fn(async () => {
          cutoffsAtFailure = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
          throw new Error("bulk write boom");
        });
        const projection = createTrackedMapProjection({ name: mapName, bulkAppend });
        const service = createServiceWithResolver();

        const result = await service.replayOptimized({
          projections: [],
          mapProjections: [projection],
          tenantIds: [tenantA],
          since: "2023-11-01",
        });

        expect(result.batchErrors).toBeGreaterThan(0);

        // The markers were live at the moment the write failed...
        expect(cutoffsAtFailure).not.toBeNull();
        expect(Object.keys(cutoffsAtFailure!)).not.toHaveLength(0);

        // ...but the failed batch's aggregates were never replayed — their
        // pending/cutoff markers must not linger for the 7-day marker TTL.
        const cutoffMarkers = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
        expect(cutoffMarkers).toEqual({});

        // The live marker checker lets the failed batch's aggregates process
        // normally — no ReplayDeferralError, no skip.
        const checker = new RedisReplayMarkerChecker(redis);
        for (const aggregateId of ["trace-a1", "trace-a2"]) {
          const decision = await checker.check(mapName, {
            tenantId: tenantA,
            aggregateType: "trace",
            aggregateId,
            id: "evt-live-after-failure",
            createdAt: Date.now(),
          } as any);
          expect(decision).toBe("process");
        }
      });

      it("keeps completed batches' done markers so a re-run skips their aggregates", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optMidRunFail_${suffix}`;

        // First batch flushes fine; the second batch's write fails, aborting
        // the run midway (aggregateBatchSize 1 → one aggregate per batch).
        // The failing call captures the cutoff hash first, so the marker
        // assertions below can't pass vacuously.
        let flushCalls = 0;
        let cutoffsAtFailure: Record<string, string> | null = null;
        const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
          flushCalls++;
          if (flushCalls === 1) return;
          cutoffsAtFailure = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
          throw new Error("bulk write boom");
        });
        const projection = createTrackedMapProjection({ name: mapName, bulkAppend });
        const service = createServiceWithResolver();

        const result = await service.replayOptimized({
          projections: [],
          mapProjections: [projection],
          tenantIds: [tenantA],
          since: "2023-11-01",
          aggregateBatchSize: 1,
        });

        expect(result.batchErrors).toBe(1);
        expect(bulkAppend).toHaveBeenCalledTimes(2);

        // Which aggregate completed first depends on discovery order — derive
        // it from the successful first flush.
        const completedId = (bulkAppend.mock.calls[0]![0] as Array<{ src: string }>)[0]!.src;
        const failedId = ["trace-a1", "trace-a2"].find((id) => id !== completedId)!;
        const completedAggKey = aggregateKey({
          tenantId: tenantA,
          aggregateType: "trace",
          aggregateId: completedId,
        });
        const failedAggKey = aggregateKey({
          tenantId: tenantA,
          aggregateType: "trace",
          aggregateId: failedId,
        });

        // The failed aggregate's cutoff marker was live at the moment its
        // write failed (the completed one had already moved to a done marker)...
        expect(cutoffsAtFailure).not.toBeNull();
        expect(Object.keys(cutoffsAtFailure!)).toEqual([failedAggKey]);

        // ...but afterwards it holds no marker of any kind — it is back to
        // unconditional live processing.
        const cutoffMarkers = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
        expect(cutoffMarkers).toEqual({});
        expect(await redis.exists(doneMarkerKey(mapName, failedAggKey))).toBe(0);

        // ... while the completed batch keeps its done marker and its
        // completed-set entry, so an operator re-run resumes past it.
        expect(await redis.exists(doneMarkerKey(mapName, completedAggKey))).toBe(1);
        expect(await redis.smembers(`${COMPLETED_KEY_PREFIX}${mapName}`)).toEqual([
          completedAggKey,
        ]);
      });
    });

    describe("when cancellation throws from onProgress mid-batch", () => {
      it("clears the batch's markers before the rethrowing emit and unpauses", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optCancelled_${suffix}`;
        const mapPauseKey = `test_pipeline/handler/${mapName}`;

        const bulkAppend = vi.fn().mockResolvedValue(undefined);
        const projection = createTrackedMapProjection({ name: mapName, bulkAppend });
        const service = createServiceWithResolver();

        // Snapshot the cutoff hash at cancellation time. onProgress is sync,
        // so the hgetall can't be awaited inside it — but it is ISSUED on the
        // shared connection before the catch's cleanup pipeline, so it
        // observes the pre-cleanup marker state (same ordering trick as the
        // batch-pause test above). `??=` keeps the first (in-try) snapshot;
        // the catch's re-emit fires a second, post-cleanup one.
        const pendingChecks: Promise<void>[] = [];
        let cutoffsAtCancel: Record<string, string> | null = null;

        // The WRITE phase is a deterministic trigger: it is emitted exactly
        // once per batch inside the try (right before the flush), and once
        // more by the catch's final emit.
        const cancellingOnProgress = (progress: { batchPhase: string }) => {
          if (progress.batchPhase !== "write") return;
          pendingChecks.push(
            redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`).then((markers) => {
              cutoffsAtCancel ??= markers;
            }),
          );
          throw new Error("replay cancelled by operator");
        };

        // The catch's final emit re-throws the cancellation — the optimized
        // run rejects instead of returning a result...
        await expect(
          service.replayOptimized(
            {
              projections: [],
              mapProjections: [projection],
              tenantIds: [tenantA],
              since: "2023-11-01",
            },
            { onProgress: cancellingOnProgress },
          ),
        ).rejects.toThrow(/replay cancelled by operator/);
        await Promise.all(pendingChecks);

        // ...before the batch's records were ever flushed.
        expect(bulkAppend).not.toHaveBeenCalled();

        // Markers were live at cancellation time and cleared BEFORE the
        // rethrowing emit — an emit-first order would skip the cleanup and
        // leave them lingering for the marker TTL.
        expect(cutoffsAtCancel).not.toBeNull();
        expect(Object.keys(cutoffsAtCancel!)).not.toHaveLength(0);
        expect(await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`)).toEqual({});

        // The per-batch finally unpaused despite the rethrow — live
        // processing is never left frozen by a cancelled run.
        expect(await redis.sismember(pausedSetKey, mapPauseKey)).toBe(0);
      });
    });

    describe("when a map write fails in a batch that also carries a fold projection", () => {
      it("keeps the fold's done markers and completed set from finished batches while clearing both cutoff hashes", async () => {
        const redis = getTestRedisConnection()!;
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const foldName = `optMixedFold_${suffix}`;
        const mapName = `optMixedMapFail_${suffix}`;

        const foldStore = vi.fn(async (_state: { count: number }, _ctx: any) => undefined);
        const foldDefinition: FoldProjectionDefinition<{ count: number }, any> = {
          name: foldName,
          version: "v1",
          eventTypes: ["trace.upserted"],
          LastEventOccurredAtKey: "LastEventOccurredAt",
          init: () => ({ count: 0 }),
          apply: (state) => ({ count: state.count + 1 }),
          store: {
            store: foldStore,
            get: vi.fn().mockResolvedValue(null),
          },
        };
        const foldProjection: RegisteredFoldProjection = {
          projectionName: foldName,
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: `test_pipeline/projection/${foldName}`,
          kind: "fold",
          definition: foldDefinition,
        };

        // First batch's map flush succeeds; the second one captures the live
        // cutoff markers (so the emptiness assertions below can't pass
        // vacuously) and then fails — AFTER the same batch's fold flush
        // already succeeded (fold accumulators flush before map ones).
        let mapFlushes = 0;
        let mapCutoffsAtFailure: Record<string, string> | null = null;
        const bulkAppend = vi.fn(async (_records: any[], _ctx: any) => {
          mapFlushes++;
          if (mapFlushes === 1) return;
          mapCutoffsAtFailure = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`);
          throw new Error("bulk write boom");
        });
        const mapProjection = createTrackedMapProjection({ name: mapName, bulkAppend });

        const service = createServiceWithResolver();

        const result = await service.replayOptimized({
          projections: [foldProjection],
          mapProjections: [mapProjection],
          tenantIds: [tenantA],
          since: "2023-11-01",
          aggregateBatchSize: 1,
        });

        expect(result.batchErrors).toBe(1);
        // The fold flushed in BOTH batches — including the one whose map
        // write aborted.
        expect(foldStore).toHaveBeenCalledTimes(2);
        expect(bulkAppend).toHaveBeenCalledTimes(2);

        // Which aggregate completed first depends on discovery order — derive
        // it from the successful first flush.
        const completedId = (bulkAppend.mock.calls[0]![0] as Array<{ src: string }>)[0]!.src;
        const failedId = ["trace-a1", "trace-a2"].find((id) => id !== completedId)!;
        const completedAggKey = aggregateKey({
          tenantId: tenantA,
          aggregateType: "trace",
          aggregateId: completedId,
        });
        const failedAggKey = aggregateKey({
          tenantId: tenantA,
          aggregateType: "trace",
          aggregateId: failedId,
        });

        // The failed aggregate's map cutoff marker was live at failure time.
        expect(mapCutoffsAtFailure).not.toBeNull();
        expect(Object.keys(mapCutoffsAtFailure!)).toEqual([failedAggKey]);

        // clearFailedBatchMarkers HDELs the failed batch's aggKeys across ALL
        // projections — including the fold, whose write had already
        // succeeded. Both cutoff hashes end empty.
        expect(await redis.hgetall(`${CUTOFF_KEY_PREFIX}${foldName}`)).toEqual({});
        expect(await redis.hgetall(`${CUTOFF_KEY_PREFIX}${mapName}`)).toEqual({});

        // ...but those extra HDELs are no-ops for done markers: the completed
        // batch keeps its done marker and completed-set entry for BOTH
        // projections, so an operator re-run resumes past it.
        expect(await redis.exists(doneMarkerKey(foldName, completedAggKey))).toBe(1);
        expect(await redis.smembers(`${COMPLETED_KEY_PREFIX}${foldName}`)).toEqual([
          completedAggKey,
        ]);
        expect(await redis.exists(doneMarkerKey(mapName, completedAggKey))).toBe(1);

        // The failed batch's aggregate holds no terminal marker for either
        // projection — it is back to unconditional live processing.
        expect(await redis.exists(doneMarkerKey(foldName, failedAggKey))).toBe(0);
        expect(await redis.exists(doneMarkerKey(mapName, failedAggKey))).toBe(0);
      });
    });
  });

  describe("replayOptimized multi-tenant batches", () => {
    describe("when a batch spans multiple tenants", () => {
      it("routes each tenant's records to its own tenant-scoped bulkAppend call", async () => {
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mapName = `optMultiTenant_${suffix}`;
        // A unique event type keeps discovery scoped to exactly the aggregates
        // seeded below, independent of data earlier tests inserted.
        const eventType = `trace.multitenant_${suffix}`;
        const aggA1 = `trace-mt-a1-${suffix}`;
        const aggA2 = `trace-mt-a2-${suffix}`;
        const aggB1 = `trace-mt-b1-${suffix}`;

        await client.insert({
          table: "event_log",
          values: [
            {
              TenantId: tenantA,
              AggregateType: "trace",
              AggregateId: aggA1,
              EventId: `evt-mt-a-001-${suffix}`,
              EventType: eventType,
              EventTimestamp: 1700000005000,
              EventOccurredAt: 1700000005000,
              EventVersion: "2025-01-01",
              EventPayload: JSON.stringify({ value: 1 }),
              _retention_days: 0,
            },
            {
              TenantId: tenantA,
              AggregateType: "trace",
              AggregateId: aggA2,
              EventId: `evt-mt-a-002-${suffix}`,
              EventType: eventType,
              EventTimestamp: 1700000006000,
              EventOccurredAt: 1700000006000,
              EventVersion: "2025-01-01",
              EventPayload: JSON.stringify({ value: 2 }),
              _retention_days: 0,
            },
            {
              TenantId: tenantB,
              AggregateType: "trace",
              AggregateId: aggB1,
              EventId: `evt-mt-b-001-${suffix}`,
              EventType: eventType,
              EventTimestamp: 1700000007000,
              EventOccurredAt: 1700000007000,
              EventVersion: "2025-01-01",
              EventPayload: JSON.stringify({ value: 3 }),
              _retention_days: 0,
            },
          ],
          format: "JSONEachRow",
        });

        // Discovery must see all three freshly inserted events — poll until
        // ClickHouse reports them visible (insert visibility is not
        // synchronous on CI).
        for (let attempt = 0; attempt < 50; attempt++) {
          const visible = await client.query({
            query: `SELECT count() AS c FROM event_log WHERE TenantId IN ({tenantA:String}, {tenantB:String}) AND EventType = {eventType:String}`,
            query_params: { tenantA, tenantB, eventType },
            format: "JSONEachRow",
          });
          const [row] = (await visible.json()) as Array<{ c: string }>;
          if (Number(row?.c) >= 3) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const bulkAppend = vi.fn().mockResolvedValue(undefined);
        const projection: RegisteredMapProjection = {
          projectionName: mapName,
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: `test_pipeline/handler/${mapName}`,
          kind: "map",
          definition: {
            name: mapName,
            eventTypes: [eventType],
            map: (event: any) => ({ src: event.aggregateId }),
            store: { append: async () => undefined, bulkAppend },
          },
        };

        const service = createServiceWithResolver();

        const result = await service.replayOptimized({
          projections: [],
          mapProjections: [projection],
          tenantIds: [tenantA, tenantB],
          since: "2023-11-01",
        });

        expect(result.batchErrors).toBe(0);
        // 2 aggregates for tenant A + 1 for tenant B, one event each.
        expect(result.aggregatesReplayed).toBe(3);
        expect(result.totalEvents).toBe(3);

        // The per-tenant cutoff/load fan-out resolved a client for each tenant.
        expect(resolverCalls).toContain(tenantA);
        expect(resolverCalls).toContain(tenantB);

        // Records flush in per-tenant chunks: exactly one tenant-scoped
        // bulkAppend per tenant, each carrying ONLY that tenant's aggregates.
        // A boundsByTenant keying bug or cross-tenant mixup in the parallel
        // cutoff/load path would drop or mix records across these calls.
        expect(bulkAppend).toHaveBeenCalledTimes(2);
        const recordsByTenant = new Map<string, string[]>();
        for (const [records, ctx] of bulkAppend.mock.calls as Array<[Array<{ src: string }>, any]>) {
          expect(recordsByTenant.has(ctx.tenantId)).toBe(false);
          recordsByTenant.set(
            ctx.tenantId,
            records.map((r) => r.src).sort(),
          );
        }
        expect(recordsByTenant.get(tenantA)).toEqual([aggA1, aggA2]);
        expect(recordsByTenant.get(tenantB)).toEqual([aggB1]);
      });
    });
  });
});
