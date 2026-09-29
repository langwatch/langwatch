import IORedis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { sealPipelineDefinition } from "../../pipeline/sealedPipeline.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../../projections/foldProjection.types.ts";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types.ts";
import { RedisCachedFoldStore } from "../../projections/redisCachedFoldStore.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import type { ReplayEvent } from "../replayEventSource.ts";
import { replayLeanOf, replayProjectionsOf } from "../replayProjections.ts";

const COUNTED = "test.counted";
const IGNORED = "test.ignored";
const eventSchemas = [
  testEventSchema(COUNTED, z.object({ note: z.string() })),
  testEventSchema(IGNORED, z.object({ note: z.string() })),
] as const;
type PipelineEvent = z.infer<(typeof eventSchemas)[number]>;

// Never connects: the cached store only holds it, and replay must not reach it.
const redis = new IORedis({ lazyConnect: true });
afterAll(() => {
  redis.disconnect();
});

function durableStore(): FoldProjectionStore<{ count: number }> {
  return { get: vi.fn(), store: vi.fn() };
}

function countFold(
  store: FoldProjectionStore<{ count: number }>,
): FoldProjectionDefinition<{ count: number }, PipelineEvent> & { readonly name: "counts" } {
  return {
    name: "counts",
    version: "2026-09-28",
    eventTypes: [COUNTED],
    init: () => ({ count: 0 }),
    apply: (state) => ({ count: state.count + 1 }),
    store,
    LastEventOccurredAtKey: "LastEventOccurredAt",
  };
}

function notesMap(targetTable?: string): MapProjectionDefinition<
  { note: string },
  PipelineEvent
> & {
  readonly name: "notes";
} {
  return {
    name: "notes",
    eventTypes: [COUNTED],
    map: (event) => ({ note: event.data.note }),
    store: { append: vi.fn() },
    ...(targetTable === undefined ? {} : { targetTable }),
  };
}

function pipelineOver(input: {
  fold: FoldProjectionDefinition<{ count: number }, PipelineEvent> & { readonly name: "counts" };
  map: MapProjectionDefinition<{ note: string }, PipelineEvent> & { readonly name: "notes" };
  prepare?: (event: PipelineEvent) => PipelineEvent;
}) {
  const builder = definePipeline({
    name: "test_processing",
    aggregate: defineAggregate({ type: "test_aggregate" }),
  })
    .withEvents(eventSchemas)
    .withClickHouseFoldProjection(input.fold)
    .withClickHouseMapProjection(input.map);
  const prepared = input.prepare
    ? builder.withProjectionPayloadPreparation(input.prepare)
    : builder;
  return sealPipelineDefinition(prepared.build());
}

function eventOf(type: string, note: string): Event {
  return {
    id: `event-${note}`,
    aggregateId: "aggregate-1",
    aggregateType: "test_aggregate",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1000,
    occurredAt: 1000,
    version: "2026-09-28",
    type,
    data: { note },
  };
}

describe("replayProjectionsOf()", () => {
  describe("when a fold's store is Redis-cached", () => {
    /** @scenario "A replay rebuilds a Redis-cached fold through its durable store" */
    it("rebuilds through the durable tier behind the cache", () => {
      const durable = durableStore();
      const cached = new RedisCachedFoldStore(durable, redis, { keyPrefix: "test" });
      const { projections } = replayProjectionsOf([
        pipelineOver({ fold: countFold(cached), map: notesMap() }),
      ]);

      const writesDurable = projections[0]?.open((fold) => Object.is(fold.store, durable));
      expect(writesDurable).toBe(true);
    });
  });

  describe("when a fold is replayed over the run's mixed events", () => {
    it("folds only the events its pipeline's type admits", () => {
      const { projections } = replayProjectionsOf([
        pipelineOver({ fold: countFold(durableStore()), map: notesMap() }),
      ]);

      const count = projections[0]?.open((fold) =>
        [eventOf(COUNTED, "a"), eventOf(IGNORED, "b"), eventOf(COUNTED, "c")].reduce(
          (state, event) => fold.apply(state, event),
          fold.init(),
        ),
      );
      expect(count).toEqual({ count: 2 });
    });
  });

  describe("when a map's owner declares its target table", () => {
    /** @scenario "A map projection's owner names the table a replay optimizes" */
    it("carries the table for the post-replay OPTIMIZE", () => {
      const { mapProjections } = replayProjectionsOf([
        pipelineOver({ fold: countFold(durableStore()), map: notesMap("stored_notes") }),
      ]);

      expect(mapProjections[0]).toMatchObject({
        projectionName: "notes",
        pipelineName: "test_processing",
        pauseKey: "test_processing/handler/notes",
        targetTable: "stored_notes",
      });
    });
  });

  describe("when a map declares no target table", () => {
    /** @scenario "A map projection's owner names the table a replay optimizes" */
    it("names none, so the rebuild optimizes nothing", () => {
      const { mapProjections } = replayProjectionsOf([
        pipelineOver({ fold: countFold(durableStore()), map: notesMap() }),
      ]);

      expect(mapProjections[0]?.targetTable).toBeUndefined();
    });
  });
});

describe("replayLeanOf()", () => {
  const replayed: ReplayEvent = {
    ...eventOf(COUNTED, "full"),
    timestamp: 1000,
    idempotencyKey: "event-full",
  };

  describe("when the declaring pipeline prepares events for its projections", () => {
    it("leans the replayed event as live dispatch does", () => {
      const lean = replayLeanOf([
        pipelineOver({
          fold: countFold(durableStore()),
          map: notesMap(),
          prepare: (event) => ({ ...event, data: { note: "lean" } }),
        }),
      ]);

      expect(lean(replayed).data).toEqual({ note: "lean" });
    });
  });

  describe("when no pipeline prepares events", () => {
    it("returns the event unchanged", () => {
      const lean = replayLeanOf([
        pipelineOver({ fold: countFold(durableStore()), map: notesMap() }),
      ]);

      expect(lean(replayed)).toBe(replayed);
    });
  });
});
