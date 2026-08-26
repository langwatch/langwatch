import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { describe, expect, it } from "vitest";
import { SpanStorageMapProjection } from "../spanStorage.mapProjection";
import {
  SPAN_STORAGE_MAP_SHARD_COUNT,
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "../spanStorageGroupKey";

/**
 * spanStorage previously grouped by `span:${event.id}` — the EVENT id — so
 * every delivery was its own single-event group: coalescing had nothing to
 * batch (a linear per-item drain cost whose constant is a full queue job —
 * the drain floor measured in the 2026-07-31 backlog), and two deliveries
 * of the SAME span could run in parallel with no ordering guarantee. Shard
 * keys fix both: same span → same lane (serialized), and a backed-up lane
 * drains in coalesced bites through the store's bulkAppend.
 */
describe("spanStorage shard group key", () => {
  const event = (spanId: string, id = `evt_${spanId}`) =>
    ({ id, metadata: { spanId, traceId: "trace_1" } }) as never;

  describe("when the same span is delivered twice", () => {
    it("routes both deliveries to the same lane", () => {
      expect(spanStorageMapGroupKey(event("span_a", "evt_1"))).toBe(
        spanStorageMapGroupKey(event("span_a", "evt_2")),
      );
    });
  });

  describe("when many distinct spans arrive", () => {
    it("distributes across multiple lanes, all within the shard count", () => {
      const lanes = new Set<string>();
      for (let i = 0; i < 500; i++) {
        const key = spanStorageMapGroupKey(event(`span_${i}`));
        expect(key).toMatch(/^span-map:\d+$/);
        const lane = Number(key.split(":")[1]);
        expect(lane).toBeGreaterThanOrEqual(0);
        expect(lane).toBeLessThan(SPAN_STORAGE_MAP_SHARD_COUNT);
        lanes.add(key);
      }
      // 500 spans over 128 lanes: overwhelmingly many lanes populated.
      expect(lanes.size).toBeGreaterThan(64);
    });
  });

  describe("when the event carries no span id in metadata", () => {
    it("falls back to hashing the event id", () => {
      const bare = { id: "evt_only", metadata: {} } as never;
      // The bare event must land on the SAME lane as an event whose spanId
      // equals the bare event's id — proving the fallback input is the event
      // id, not a constant.
      const spanIdMatchingBareId = event("evt_only", "evt_other");
      expect(spanStorageMapGroupKey(bare)).toBe(
        spanStorageMapGroupKey(spanIdMatchingBareId),
      );
      expect(spanStorageMapGroupKey(bare)).toMatch(/^span-map:\d+$/);
    });
  });

  describe("when events for the same span belong to different tenants", () => {
    it("returns the same lane — tenant scoping is the queue prefix's job", () => {
      // The queue composes the full group id as
      // `<tenantId>/map/spanStorage/<domainKey>`, so the domain key must be a
      // pure function of the span identity: same span id → same lane string,
      // and the tenant prefix keeps lanes tenant-scoped.
      const a = {
        id: "evt_1",
        tenantId: "tenant_a",
        metadata: { spanId: "span_s", traceId: "t" },
      } as never;
      const b = {
        id: "evt_2",
        tenantId: "tenant_b",
        metadata: { spanId: "span_s", traceId: "t" },
      } as never;
      expect(spanStorageMapGroupKey(a)).toBe(spanStorageMapGroupKey(b));
    });
  });

  describe("when the projection is constructed", () => {
    it("declares the shard key and the coalesce ceiling", () => {
      const projection = new SpanStorageMapProjection({
        store: {} as never,
        traceCanonicalisation: TraceCanonicalisationService.create(),
      });

      expect(projection.options.coalesceMaxBatch).toBe(
        TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
      );
      // 256 is deliberate (matches the log/metric map ceilings); changing it
      // is a decision, so the exact value is pinned.
      expect(TRACE_SPAN_MAP_COALESCE_MAX_BATCH).toBe(256);
      // Guard against regressing to the per-event key.
      expect(projection.options.groupKeyFn(event("span_x", "evt_unique"))).not.toContain(
        "evt_unique",
      );
      expect(projection.options.groupKeyFn(event("span_x"))).toBe(
        spanStorageMapGroupKey(event("span_x")),
      );
    });
  });
});
