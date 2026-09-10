import {
  aggregateKey,
  type Event,
  type CutoffInfo,
  type DiscoveredAggregate,
  type MapProjectionDefinition,
  type OccurredAtBounds,
  type RegisteredMapProjection,
  type ReplayEvent,
  type ReplayEventSource,
  ReplayService as EventingReplayService,
  unmarkBatch,
} from "@langwatch/eventing";
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpsReplayRuntimePort, type OpsReplayRuntime } from "../../app/ops.app.ts";
import { ReplayRedisRepository } from "../../repositories/redis/redis.replay.repository.ts";
import { ReplayService } from "../replay.service.ts";

/**
 * A replay that is cancelled or fails leaves its completed markers in Redis on
 * purpose, so a plain re-run resumes instead of repeating work. When the target
 * table has meanwhile been emptied, that same behaviour makes the rebuild
 * report success while silently skipping every aggregate the earlier run had
 * finished. `fullRebuild` clears those markers under the replay lock, before
 * discovery, so the rebuild covers them.
 */

const PROJECTION_NAME = "traceAnalyticsRollup";
const AGGREGATE_TYPE = "trace";
const PIPELINE = "trace_processing";
const SINCE = new Date(0).toISOString();
const BASE_MS = Date.now() - 24 * 60 * 60 * 1000;

/** An in-memory event history behind the port the replay engine reads through. */
class MemoryEventSource implements ReplayEventSource {
  constructor(private readonly events: ReplayEvent[]) {}

  private matching(tenantId?: string): ReplayEvent[] {
    return this.events.filter((event) => tenantId === undefined || event.tenantId === tenantId);
  }

  async discoverAffectedAggregates(input: {
    tenantId?: string;
  }): Promise<Array<DiscoveredAggregate & { eventTypes: string[] }>> {
    return this.matching(input.tenantId).map((event) => ({
      tenantId: event.tenantId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventTypes: [event.type],
    }));
  }

  async countEventsForAggregates(input: { tenantId?: string }): Promise<number> {
    return this.matching(input.tenantId).length;
  }

  async getBoundedCutoffs(input: { tenantId: string; aggregateIds: string[] }): Promise<{
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds: OccurredAtBounds | undefined;
  }> {
    const selected = this.matching(input.tenantId).filter((event) =>
      input.aggregateIds.includes(event.aggregateId),
    );
    const cutoffs = new Map<string, CutoffInfo>();
    for (const event of selected) {
      cutoffs.set(aggregateKey(event), { timestamp: event.timestamp, eventId: event.id });
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
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    const selected = this.matching(input.tenantId).filter((event) =>
      input.aggregateIds.includes(event.aggregateId),
    );
    for (const event of selected) await input.onEvent(event);
    return { eventsApplied: selected.length };
  }

  async loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
  }): Promise<ReplayEvent[]> {
    return this.matching(input.tenantId).filter((event) =>
      input.aggregateIds.includes(event.aggregateId),
    );
  }
}

describe("ops replay full rebuild", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(async () => {
    const keys = await redis.keys("projection-replay:*");
    if (keys.length > 0) await redis.del(...keys);
    const opsKeys = await redis.keys("ops:replay:*");
    if (opsKeys.length > 0) await redis.del(...opsKeys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  /**
   * Leaves behind exactly what an aborted run leaves: the aggregate recorded in
   * the projection's completed set, written by the helper the replay itself
   * uses.
   */
  async function seedCompletedMarker(tenantId: string, traceId: string): Promise<void> {
    await unmarkBatch({
      redis,
      projectionName: PROJECTION_NAME,
      aggKeys: [aggregateKey({ tenantId, aggregateType: AGGREGATE_TYPE, aggregateId: traceId })],
    });
  }

  function opsServiceOver({
    tenantId,
    traceId,
    bulkAppend,
  }: {
    tenantId: string;
    traceId: string;
    bulkAppend: () => Promise<void>;
  }): ReplayService {
    const event: ReplayEvent = {
      id: `evt-${traceId}`,
      aggregateId: traceId,
      aggregateType: AGGREGATE_TYPE,
      tenantId,
      createdAt: BASE_MS,
      timestamp: BASE_MS,
      occurredAt: BASE_MS,
      type: "trace.span_received",
      version: "2025-12-14",
      idempotencyKey: `evt-${traceId}`,
      data: {},
    };

    const mapProjection: RegisteredMapProjection = {
      projectionName: PROJECTION_NAME,
      pipelineName: PIPELINE,
      aggregateType: AGGREGATE_TYPE,
      source: "pipeline",
      pauseKey: `${PIPELINE}/handler/${PROJECTION_NAME}`,
      kind: "map",
      definition: {
        name: PROJECTION_NAME,
        eventTypes: ["trace.span_received"],
        map: (mapped: ReplayEvent) => ({ src: mapped.aggregateId }),
        store: { append: async () => undefined, bulkAppend },
      } as unknown as MapProjectionDefinition<any, Event>,
    };

    const runtimeFactory = new (class extends OpsReplayRuntimePort {
      create(): OpsReplayRuntime {
        return {
          service: new EventingReplayService({
            eventSource: new MemoryEventSource([event]),
            redis,
          }),
          projections: [],
          mapProjections: [mapProjection],
          stateProjections: [],
          close: async () => {},
        };
      }
    })();

    return ReplayService.create({
      repo: ReplayRedisRepository.create({ redis }),
      runtimeFactory,
    });
  }

  /** Waits for the run to leave the running state, so its outcome is settled. */
  async function waitForIdle(service: ReplayService): Promise<void> {
    await vi.waitFor(
      async () => {
        expect((await service.getStatus()).state).not.toBe("running");
      },
      { timeout: 15_000, interval: 50 },
    );
  }

  describe("given an interrupted run left an aggregate marked completed", () => {
    describe("when the replay resumes without a full rebuild", () => {
      it("skips the aggregate the earlier run had finished", async () => {
        const tenantId = `tenant-skip-${Date.now()}`;
        const traceId = `trace-skip-${Date.now()}`;
        const bulkAppend = vi.fn(async () => undefined);
        await seedCompletedMarker(tenantId, traceId);

        const service = opsServiceOver({ tenantId, traceId, bulkAppend });
        await service.startReplay({
          projectionNames: [PROJECTION_NAME],
          since: SINCE,
          tenantIds: [tenantId],
          description: "resume",
          userName: "test",
        });
        await waitForIdle(service);

        // The completed marker is the whole reason: nothing was rebuilt.
        expect(bulkAppend).not.toHaveBeenCalled();
      });
    });

    describe("when the replay is started as a full rebuild", () => {
      /** @scenario A full rebuild replays aggregates an interrupted run had completed */
      it("clears the markers before discovery so the aggregate is replayed", async () => {
        const tenantId = `tenant-rebuild-${Date.now()}`;
        const traceId = `trace-rebuild-${Date.now()}`;
        const bulkAppend = vi.fn(async () => undefined);
        await seedCompletedMarker(tenantId, traceId);

        const service = opsServiceOver({ tenantId, traceId, bulkAppend });
        await service.startReplay({
          projectionNames: [PROJECTION_NAME],
          since: SINCE,
          tenantIds: [tenantId],
          fullRebuild: true,
          description: "full rebuild",
          userName: "test",
        });
        await waitForIdle(service);

        expect(bulkAppend).toHaveBeenCalledTimes(1);
        const records = (
          bulkAppend.mock.calls as unknown as [{ src: string }[], unknown][]
        ).flatMap(([recs]) => recs);
        expect(records.map((record) => record.src)).toEqual([traceId]);
      });
    });
  });
});
