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

import type { OpsReplayRuntimeFactory, OpsReplayRuntime } from "../../app/ops.app.ts";
import { ReplayRedisRepository } from "../../repositories/redis/redis.replay.repository.ts";
import { ReplayService } from "../replay.service.ts";

type ReplayRedisPipeline = {
  hset(key: string, field: string, value: string): ReplayRedisPipeline;
  hdel(key: string, ...fields: string[]): ReplayRedisPipeline;
  sadd(key: string, ...members: string[]): ReplayRedisPipeline;
  smembers(key: string): ReplayRedisPipeline;
  get(key: string): ReplayRedisPipeline;
  set(key: string, value: string, expiry: "EX", seconds: number): ReplayRedisPipeline;
  expire(key: string, seconds: number): ReplayRedisPipeline;
  exec(): Promise<readonly [Error | null, unknown][] | null>;
};

type ReplayRedis = {
  pipeline(): ReplayRedisPipeline;
  smembers(key: string): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  hlen(key: string): Promise<number>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
};

/**
 * A cancelled/failed replay leaves completed markers in Redis so a re-run
 * resumes rather than repeats - but an emptied target table then makes the
 * rebuild silently skip finished work, which `fullRebuild` fixes by clearing them.
 */

const PROJECTION_NAME = "traceAnalyticsRollup";
const AGGREGATE_TYPE = "trace";
const PIPELINE = "trace_processing";
const SINCE = new Date(0).toISOString();
const BASE_MS = Date.now() - 24 * 60 * 60 * 1000;

class RedisReplayAdapter implements ReplayRedis {
  constructor(private readonly redis: Redis) {}

  pipeline(): ReplayRedisPipeline {
    const pipeline = this.redis.pipeline();

    return {
      hset: (key, field, value) => {
        pipeline.hset(key, field, value);
        return this.pipelineResult(pipeline);
      },
      hdel: (key, ...fields) => {
        pipeline.hdel(key, ...fields);
        return this.pipelineResult(pipeline);
      },
      sadd: (key, ...members) => {
        pipeline.sadd(key, ...members);
        return this.pipelineResult(pipeline);
      },
      smembers: (key) => {
        pipeline.smembers(key);
        return this.pipelineResult(pipeline);
      },
      get: (key) => {
        pipeline.get(key);
        return this.pipelineResult(pipeline);
      },
      set: (key, value, expiry, seconds) => {
        pipeline.set(key, value, expiry, seconds);
        return this.pipelineResult(pipeline);
      },
      expire: (key, seconds) => {
        pipeline.expire(key, seconds);
        return this.pipelineResult(pipeline);
      },
      exec: () => pipeline.exec(),
    };
  }

  smembers(key: string) {
    return this.redis.smembers(key);
  }
  hgetall(key: string) {
    return this.redis.hgetall(key);
  }
  hdel(key: string, ...fields: string[]) {
    return this.redis.hdel(key, ...fields);
  }
  del(...keys: string[]) {
    return this.redis.del(...keys);
  }
  scard(key: string) {
    return this.redis.scard(key);
  }
  hlen(key: string) {
    return this.redis.hlen(key);
  }
  scan(cursor: string, ...args: (string | number)[]) {
    if (args.length === 0) return this.redis.scan(cursor);
    const pattern = args[1];
    const count = args[3];
    const isMatchCount = args.length === 4 && args[0] === "MATCH" && args[2] === "COUNT";
    if (isMatchCount && typeof pattern === "string" && typeof count === "number") {
      return this.redis.scan(cursor, "MATCH", pattern, "COUNT", count);
    }
    throw new Error("unsupported replay scan");
  }
  sadd(key: string, ...members: string[]) {
    return this.redis.sadd(key, ...members);
  }
  srem(key: string, ...members: string[]) {
    return this.redis.srem(key, ...members);
  }
  lpush(key: string, ...values: string[]) {
    return this.redis.lpush(key, ...values);
  }

  private pipelineResult(pipeline: ReturnType<Redis["pipeline"]>): ReplayRedisPipeline {
    return {
      hset: (key, field, value) => {
        pipeline.hset(key, field, value);
        return this.pipelineResult(pipeline);
      },
      hdel: (key, ...fields) => {
        pipeline.hdel(key, ...fields);
        return this.pipelineResult(pipeline);
      },
      sadd: (key, ...members) => {
        pipeline.sadd(key, ...members);
        return this.pipelineResult(pipeline);
      },
      smembers: (key) => {
        pipeline.smembers(key);
        return this.pipelineResult(pipeline);
      },
      get: (key) => {
        pipeline.get(key);
        return this.pipelineResult(pipeline);
      },
      set: (key, value, expiry, seconds) => {
        pipeline.set(key, value, expiry, seconds);
        return this.pipelineResult(pipeline);
      },
      expire: (key, seconds) => {
        pipeline.expire(key, seconds);
        return this.pipelineResult(pipeline);
      },
      exec: () => pipeline.exec(),
    };
  }
}

/** An in-memory event history behind the port the replay engine reads through. */
class MemoryEventSource implements ReplayEventSource {
  constructor(private readonly events: ReplayEvent[]) {}

  private matching(tenantId?: string): ReplayEvent[] {
    return this.events.filter((event) => tenantId === undefined || event.tenantId === tenantId);
  }

  async discoverAffectedAggregates(input: {
    tenantId?: string;
  }): Promise<(DiscoveredAggregate & { eventTypes: string[] })[]> {
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
  let replayRedis: RedisReplayAdapter;

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
    replayRedis = new RedisReplayAdapter(redis);
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
      redis: replayRedis,
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

    const runtimeFactory = new (class implements OpsReplayRuntimeFactory {
      create(): OpsReplayRuntime {
        return {
          service: new EventingReplayService({
            eventSource: new MemoryEventSource([event]),
            redis: replayRedis,
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
