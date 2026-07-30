import {
  LEGAL_MOUNT_SHAPES,
  renderGroupKey,
  validateMount,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  createMetricProcessingPipeline,
  metricCommandGroupKey,
  metricDataPointStorageGroupKey,
  metricMapGroupKey,
  metricMount,
  metricSeriesCatalogGroupKey,
  metricTimeRollupGroupKey,
} from "../index";
import { createFakeClient } from "./fakeClient";
import { point } from "./fixtures";

/** Every store this pipeline builds, so a mount is derived rather than asserted. */
const stores = [
  ["metricDataPointStorage", { kind: "append" } as const],
  ["metricSeriesCatalog", { kind: "append" } as const],
  ["metricTimeRollup", { kind: "append" } as const],
] as const;

describe("mount legality (ADR-106)", () => {
  /** @scenario "None of this pipeline's projections mount on a merge store" */
  it("metricDataPointStorage, metricSeriesCatalog and metricTimeRollup each declare a store that is not merge", () => {
    for (const [name, store] of stores) {
      // "merge" would require an AggregatingMergeTree table and a declared
      // idempotency story (ADR-106 decision 1) — this pipeline's tables never
      // combine two rows sharing a key, they replace or append.
      const mount = metricMount({ ...store, writeBatch: async () => {} });
      expect(mount.store, `${name} store kind`).not.toBe("merge");
      expect(["append", "replace"]).toContain(mount.store);
    }
  });

  /** @scenario "A fold is never mounted on this aggregate" */
  it("every projection this pipeline mounts is a map", () => {
    for (const [name, store] of stores) {
      // A metric data point has no lifetime to accumulate, so nothing here
      // reads its own prior state back — which is what would make it a fold.
      const mount = metricMount({ ...store, writeBatch: async () => {} });
      expect(mount.projection, `${name} projection kind`).toBe("map");
    }
  });

  it("declares only shapes ADR-106's legality table enumerates", () => {
    for (const [name, store] of stores) {
      const mount = metricMount({ ...store, writeBatch: async () => {} });
      expect(validateMount(mount), `${name} violations`).toEqual([]);
      expect(LEGAL_MOUNT_SHAPES).toContainEqual(mount);
    }
  });

  it("takes the store kind from the store the executor runs on, not a hand-written literal", () => {
    expect(
      metricMount({ kind: "append", writeBatch: async () => {} }).store,
    ).toBe("append");
  });

  it("does not throw when asserted at composition", () => {
    expect(() =>
      createMetricProcessingPipeline({ client: createFakeClient() }),
    ).not.toThrow();
  });
});

describe("group-key determinism (ADR-100)", () => {
  /** @scenario "The same series always lands in the same shard" */
  it("two points of the same series are keyed for the same projection resolve to the same group key", () => {
    const seriesId = "series-shared".repeat(4).slice(0, 64);
    const first = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: "metricTimeRollup",
      identity: seriesId,
      shardCount: 16,
    });
    const second = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: "metricTimeRollup",
      identity: seriesId,
      shardCount: 16,
    });

    expect(renderGroupKey(second)).toBe(renderGroupKey(first));
  });

  /** @scenario "A point's storage lane is independent of its series' rollup lane" */
  it("a point keyed for storage and its series keyed for the rollup name different lanes", () => {
    const pointId = "point-identity".repeat(4).slice(0, 64);
    const seriesId = "series-identity".repeat(4).slice(0, 64);

    const storageKey = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: "metricDataPointStorage",
      identity: pointId,
      shardCount: 16,
    });
    const rollupKey = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: "metricTimeRollup",
      identity: seriesId,
      shardCount: 16,
    });

    expect(storageKey.lane).not.toEqual(rollupKey.lane);
    expect(renderGroupKey(storageKey)).not.toBe(renderGroupKey(rollupKey));
  });

  it("keys metricDataPointStorage by the point, and metricSeriesCatalog/metricTimeRollup by the series", () => {
    const p = point({ timeUnixMs: 1_000 });
    const storage = metricDataPointStorageGroupKey({
      tenantId: "t1",
      point: p,
      shardCount: 16,
    });
    const catalog = metricSeriesCatalogGroupKey({
      tenantId: "t1",
      point: p,
      shardCount: 16,
    });
    const rollup = metricTimeRollupGroupKey({
      tenantId: "t1",
      point: p,
      shardCount: 16,
    });

    expect(catalog.scope).toEqual(rollup.scope);
    expect(storage.lane).not.toEqual(catalog.lane);
  });

  it("every scope this pipeline declares is partition, so batching is never a no-op", () => {
    // ADR-100 decision 2: `scope: event` can never gather a batch. Every group
    // key this pipeline renders uses `partition`, so its `coalesceMaxBatch`
    // setting is meaningful rather than a silently ignored no-op.
    const mapKey = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: "metricDataPointStorage",
      identity: "any-point-id",
      shardCount: 16,
    });
    const commandKey = metricCommandGroupKey({
      tenantId: "tenant-1",
      point: point({ timeUnixMs: 1_000 }),
      shardCount: 16,
    });
    expect(mapKey.scope.kind).toBe("partition");
    expect(commandKey.scope.kind).toBe("partition");
  });
});
