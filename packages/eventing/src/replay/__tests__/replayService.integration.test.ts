import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types";
import type {
  StateProjectionDefinition,
  StateProjectionStore,
} from "../../projections/stateProjection.types";
import { COMPLETED_KEY_PREFIX, CUTOFF_KEY_PREFIX } from "../replayConstants";
import type {
  CutoffInfo,
  DiscoveredAggregateWithEventTypes,
  OccurredAtBounds,
  ReplayEvent,
  ReplayEventSource,
} from "../replayEventSource";
import { aggregateKey } from "../replayMarkers";
import { ReplayService } from "../replayService";
import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
} from "../types";

/**
 * The replay engine against a real Redis (its markers and pause set live
 * there) and an in-memory event history behind the `ReplayEventSource` port.
 * The port is the seam the durable store sits behind, so a history double
 * exercises exactly the reads the engine makes — including the event-type
 * filter, which is what keeps a rebuild from paying for events no selected
 * projection consumes.
 */

const PAUSED_SET_KEY = "{event-sourcing/jobs}:gq:paused-jobs";
const PIPELINE = "test_pipeline";
const BASE_MS = 1_700_000_000_000;

/** An in-memory event history answering the reads the engine makes. */
class MemoryEventSource implements ReplayEventSource {
  constructor(private readonly events: ReplayEvent[]) {}

  private matching({
    eventTypes,
    sinceMs,
    tenantId,
  }: {
    eventTypes: readonly string[];
    sinceMs?: number;
    tenantId?: string;
  }): ReplayEvent[] {
    return this.events.filter(
      (event) =>
        eventTypes.includes(event.type) &&
        (sinceMs === undefined || event.timestamp >= sinceMs) &&
        (tenantId === undefined || event.tenantId === tenantId),
    );
  }

  async discoverAffectedAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<DiscoveredAggregateWithEventTypes[]> {
    const byKey = new Map<string, DiscoveredAggregateWithEventTypes>();
    for (const event of this.matching(input)) {
      const key = aggregateKey(event);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.eventTypes.includes(event.type)) existing.eventTypes.push(event.type);
        continue;
      }
      byKey.set(key, {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [event.type],
      });
    }
    return [...byKey.values()];
  }

  async countEventsForAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<number> {
    return this.matching(input).length;
  }

  async getBoundedCutoffs(input: {
    tenantId: string;
    aggregateTypes: string[];
    aggregateIds: string[];
    eventTypes: readonly string[];
  }): Promise<{
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds: OccurredAtBounds | undefined;
  }> {
    const selected = this.matching({
      eventTypes: input.eventTypes,
      tenantId: input.tenantId,
    }).filter((event) => input.aggregateIds.includes(event.aggregateId));

    const cutoffs = new Map<string, CutoffInfo>();
    for (const event of selected) {
      const key = aggregateKey(event);
      const current = cutoffs.get(key);
      if (!current || event.timestamp > current.timestamp) {
        cutoffs.set(key, { timestamp: event.timestamp, eventId: event.id });
      }
    }
    if (selected.length === 0) return { cutoffs, occurredAtBounds: undefined };
    return {
      cutoffs,
      occurredAtBounds: {
        minMs: Math.min(...selected.map((event) => event.occurredAt)),
        maxMs: Math.max(...selected.map((event) => event.occurredAt)),
      },
    };
  }

  async streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    const selected = this.matching({
      eventTypes: input.eventTypes,
      tenantId: input.tenantId,
    })
      .filter((event) => input.aggregateIds.includes(event.aggregateId))
      .filter((event) => {
        const cutoff = input.cutoffs.get(aggregateKey(event));
        return cutoff !== undefined && event.timestamp <= cutoff.timestamp;
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const event of selected) await input.onEvent(event);
    return { eventsApplied: selected.length };
  }

  async loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
  }): Promise<ReplayEvent[]> {
    return this.matching({ eventTypes: input.eventTypes, tenantId: input.tenantId })
      .filter((event) => input.aggregateIds.includes(event.aggregateId))
      .filter((event) => event.timestamp <= input.maxCutoff.timestamp)
      .filter((event) => input.cursor === undefined || event.timestamp > input.cursor.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, input.batchSize);
  }
}

function makeEvent(over: Partial<ReplayEvent> & { id: string; tenantId: string }): ReplayEvent {
  return {
    aggregateId: "trace-a1",
    aggregateType: "trace",
    createdAt: BASE_MS,
    timestamp: BASE_MS,
    occurredAt: BASE_MS,
    type: "trace.upserted",
    version: "2025-01-01",
    idempotencyKey: over.id,
    data: { value: 1 },
    ...over,
  };
}

function mapProjectionOver({
  name,
  eventTypes = ["trace.upserted"],
  bulkAppend,
}: {
  name: string;
  eventTypes?: string[];
  bulkAppend: (...args: never[]) => Promise<void>;
}): RegisteredMapProjection {
  return {
    projectionName: name,
    pipelineName: PIPELINE,
    aggregateType: "trace",
    source: "pipeline",
    pauseKey: `${PIPELINE}/handler/${name}`,
    kind: "map",
    definition: {
      name,
      eventTypes,
      map: (event: ReplayEvent) => ({ src: event.aggregateId, type: event.type }),
      store: { append: async () => undefined, bulkAppend },
    } as unknown as MapProjectionDefinition<any, Event>,
  };
}

describe("ReplayService", () => {
  let redis: Redis;
  const suiteKeys: string[] = [];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  afterEach(async () => {
    if (suiteKeys.length > 0) await redis.del(...suiteKeys.splice(0));
    await redis.del(PAUSED_SET_KEY);
  });

  afterAll(async () => {
    await redis.quit();
  });

  function serviceOver(events: ReplayEvent[]): ReplayService {
    return new ReplayService({ eventSource: new MemoryEventSource(events), redis });
  }

  function trackMarkers(projectionName: string): void {
    suiteKeys.push(
      `${CUTOFF_KEY_PREFIX}${projectionName}`,
      `${COMPLETED_KEY_PREFIX}${projectionName}`,
    );
  }

  describe("when a batch of mapped records is rebuilt", () => {
    /** @scenario Live processing resumes before the batch's records are rebuilt */
    it("drains, marks cutoffs, bulk-appends mapped records, and cleans markers", async () => {
      const tenant = `tenant-live-${Date.now()}`;
      const name = `mapReplayHappy_${Date.now()}`;
      trackMarkers(name);
      const pauseKey = `${PIPELINE}/handler/${name}`;

      // Capture pause-set membership AND the cutoff hash at the moment records
      // are flushed. The pause window ends once the batch's cutoffs are
      // recorded, so the WRITE phase must run unpaused — protected by the
      // still-live cutoff markers, which the live checker uses to skip or
      // defer the batch's aggregates.
      let pausedDuringWrite: number | null = null;
      let cutoffsDuringWrite: Record<string, string> | null = null;
      const bulkAppend = vi.fn(async () => {
        pausedDuringWrite = await redis.sismember(PAUSED_SET_KEY, pauseKey);
        cutoffsDuringWrite = await redis.hgetall(`${CUTOFF_KEY_PREFIX}${name}`);
      });

      const service = serviceOver([
        makeEvent({ id: "evt-1", tenantId: tenant, aggregateId: "trace-a1" }),
        makeEvent({
          id: "evt-2",
          tenantId: tenant,
          aggregateId: "trace-a2",
          timestamp: BASE_MS + 1000,
          occurredAt: BASE_MS + 1000,
        }),
      ]);

      const result = await service.replay({
        projections: [],
        mapProjections: [mapProjectionOver({ name, bulkAppend })],
        tenantIds: [tenant],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(2);
      expect(result.totalEvents).toBe(2);

      // Records flushed via ONE tenant-scoped bulk call covering both
      // aggregates — never one awaited call per aggregate, which is the
      // per-trace grouping that made large replays take weeks.
      expect(bulkAppend).toHaveBeenCalledTimes(1);
      const appended = (bulkAppend.mock.calls as unknown as [{ src: string }[], unknown][]).flatMap(
        ([records]) => records,
      );
      expect(appended.map((record) => record.src).sort()).toEqual(["trace-a1", "trace-a2"]);
      for (const [, context] of bulkAppend.mock.calls as unknown as [
        unknown,
        { tenantId: string },
      ][]) {
        expect(context.tenantId).toBe(tenant);
      }

      // The queue was already flowing again while records were being written...
      expect(pausedDuringWrite).toBe(0);
      // ...while the batch's cutoff markers were still live at write time,
      // which is what protects the rebuild from interleaving live writes.
      expect(cutoffsDuringWrite).not.toBeNull();
      expect(Object.keys(cutoffsDuringWrite!)).not.toHaveLength(0);

      expect(await redis.sismember(PAUSED_SET_KEY, pauseKey)).toBe(0);
      // Final cleanup removed both replay marker keys.
      expect(await redis.exists(`${CUTOFF_KEY_PREFIX}${name}`)).toBe(0);
      expect(await redis.exists(`${COMPLETED_KEY_PREFIX}${name}`)).toBe(0);
    });
  });

  describe("when the history holds events no selected projection consumes", () => {
    /** @scenario The rebuild reads only the events the replayed projections consume */
    it("reads only the selected projections' event types from the event history", async () => {
      const tenant = `tenant-union-${Date.now()}`;
      const name = `unionFilter_${Date.now()}`;
      trackMarkers(name);
      const bulkAppend = vi.fn(async () => undefined);

      const service = serviceOver([
        makeEvent({ id: "evt-c-001", tenantId: tenant, aggregateId: "trace-c1" }),
        makeEvent({
          id: "evt-c-002",
          tenantId: tenant,
          aggregateId: "trace-c1",
          type: "trace.noise",
          timestamp: BASE_MS + 500,
          occurredAt: BASE_MS + 500,
        }),
      ]);

      const result = await service.replay({
        projections: [],
        mapProjections: [mapProjectionOver({ name, bulkAppend })],
        tenantIds: [tenant],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(1);
      // Only the consumed event was read and processed — the noise event never
      // left the history.
      expect(result.totalEvents).toBe(1);
      const records = (bulkAppend.mock.calls as unknown as [{ type: string }[], unknown][]).flatMap(
        ([recs]) => recs,
      );
      expect(records.map((record) => record.type)).toEqual(["trace.upserted"]);
    });
  });

  describe("when a run selects fold, map and state projections at once", () => {
    /** @scenario State projections replay in the same run as fold and map projections */
    it("rebuilds all three kinds — folds and maps through the engine, state in its own lane", async () => {
      const tenant = `tenant-tri-${Date.now()}`;
      const suffix = `${Date.now()}`;
      const foldName = `triFold_${suffix}`;
      const mapName = `triMap_${suffix}`;
      const stateName = `triState_${suffix}`;
      trackMarkers(foldName);
      trackMarkers(mapName);
      trackMarkers(stateName);

      const foldStore = vi.fn(async () => undefined);
      const foldProjection: RegisteredFoldProjection = {
        projectionName: foldName,
        pipelineName: PIPELINE,
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `${PIPELINE}/projection/${foldName}`,
        kind: "fold",
        definition: {
          name: foldName,
          version: "v1",
          eventTypes: ["trace.upserted"],
          LastEventOccurredAtKey: "LastEventOccurredAt",
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
          store: { store: foldStore, get: vi.fn().mockResolvedValue(null) },
        } as unknown as FoldProjectionDefinition<any, Event>,
      };

      const bulkAppend = vi.fn(async () => undefined);

      const stateWrites: unknown[] = [];
      const stateStore = {
        load: vi.fn(async () => null),
        store: vi.fn(async (stored: unknown) => {
          stateWrites.push(stored);
        }),
      } as unknown as StateProjectionStore<{ seen: number }>;
      const stateProjection: RegisteredStateProjection = {
        projectionName: stateName,
        pipelineName: PIPELINE,
        aggregateType: "trace",
        source: "pipeline",
        pauseKey: `${PIPELINE}/stateProjection/${stateName}`,
        kind: "state",
        definition: {
          name: stateName,
          version: "v1",
          eventTypes: ["trace.upserted"],
          init: () => ({ seen: 0 }),
          apply: (state: { seen: number }) => ({ seen: state.seen + 1 }),
          store: stateStore,
        } as unknown as StateProjectionDefinition<any, Event>,
      };

      const service = serviceOver([
        makeEvent({ id: "evt-1", tenantId: tenant, aggregateId: "trace-a1" }),
        makeEvent({
          id: "evt-2",
          tenantId: tenant,
          aggregateId: "trace-a2",
          timestamp: BASE_MS + 1000,
          occurredAt: BASE_MS + 1000,
        }),
      ]);

      const result = await service.replay({
        projections: [foldProjection],
        mapProjections: [mapProjectionOver({ name: mapName, bulkAppend })],
        stateProjections: [stateProjection],
        tenantIds: [tenant],
        since: "2023-11-01",
      });

      expect(result.batchErrors).toBe(0);
      // The fold and map replay share one event load (2 aggregates, 2 events,
      // counted once); the state lane replays the same 2 events into its own
      // store afterwards.
      expect(result.totalEvents).toBe(4);
      expect(foldStore).toHaveBeenCalledTimes(2);
      expect(bulkAppend).toHaveBeenCalledTimes(1);
      expect(stateWrites.length).toBeGreaterThan(0);
    });
  });

  describe("when a replay spans multiple batches", () => {
    /** @scenario Only the batch being replayed pauses live processing */
    it("pauses only while a batch is replayed and resumes between batches", async () => {
      const tenant = `tenant-batch-${Date.now()}`;
      const name = `optBatchPause_${Date.now()}`;
      trackMarkers(name);
      const pauseKey = `${PIPELINE}/handler/${name}`;

      const pausedDuringWrite: number[] = [];
      const bulkAppend = vi.fn(async () => {
        pausedDuringWrite.push(await redis.sismember(PAUSED_SET_KEY, pauseKey));
      });

      const service = serviceOver([
        makeEvent({ id: "evt-1", tenantId: tenant, aggregateId: "trace-a1" }),
        makeEvent({
          id: "evt-2",
          tenantId: tenant,
          aggregateId: "trace-a2",
          timestamp: BASE_MS + 1000,
          occurredAt: BASE_MS + 1000,
        }),
      ]);

      const pausedAtBatchComplete: number[] = [];
      const pendingChecks: Promise<void>[] = [];

      // aggregateBatchSize 1 with two aggregates gives two batches.
      const result = await service.replayOptimized(
        {
          projections: [],
          mapProjections: [mapProjectionOver({ name, bulkAppend })],
          tenantIds: [tenant],
          since: "2023-11-01",
          aggregateBatchSize: 1,
        },
        {
          onBatchComplete: () => {
            // Issued synchronously here (same connection, ordered before the
            // next batch's re-pause) but resolving async — collected so the
            // assertions wait for it.
            pendingChecks.push(
              redis.sismember(PAUSED_SET_KEY, pauseKey).then((paused) => {
                pausedAtBatchComplete.push(paused);
              }),
            );
          },
        },
      );
      await Promise.all(pendingChecks);

      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(2);

      // One flush per batch — each batch's records land AFTER its unpause,
      // with the cutoff markers carrying the protection through the write.
      expect(bulkAppend).toHaveBeenCalledTimes(2);
      expect(pausedDuringWrite).toEqual([0, 0]);
      // Between batches live processing is running again — the freeze is
      // per-batch, never for the whole run.
      expect(pausedAtBatchComplete).toEqual([0, 0]);
      expect(await redis.sismember(PAUSED_SET_KEY, pauseKey)).toBe(0);
    });
  });
});
