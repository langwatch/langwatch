import { renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { metricMapGroupKey } from "../groupKeys";
import {
  METRIC_DATA_POINT_STORAGE_MOUNT,
  METRIC_SERIES_CATALOG_MOUNT,
  METRIC_TIME_ROLLUP_MOUNT,
} from "../mountDescriptors";
import { METRIC_DATA_POINT_STORAGE_PROJECTION } from "../projections/metricDataPointStorage";
import { METRIC_TIME_ROLLUP_PROJECTION } from "../projections/metricTimeRollup";

const ALL_MOUNTS = {
  metricDataPointStorage: METRIC_DATA_POINT_STORAGE_MOUNT,
  metricSeriesCatalog: METRIC_SERIES_CATALOG_MOUNT,
  metricTimeRollup: METRIC_TIME_ROLLUP_MOUNT,
} as const;

describe("mount legality (ADR-106)", () => {
  /** @scenario "None of this pipeline's projections mount on a merge store" */
  it("metricDataPointStorage, metricSeriesCatalog and metricTimeRollup each declare a store that is not merge", () => {
    for (const [name, mount] of Object.entries(ALL_MOUNTS)) {
      // "merge" would require an AggregatingMergeTree table and a declared
      // idempotency story (ADR-106 decision 1) — this pipeline's tables never
      // combine two rows sharing a key, they replace or append, so `store`
      // may only ever be one of these two values.
      expect(mount.store, `${name} store kind`).not.toBe("merge");
      expect(["append", "replace"]).toContain(mount.store);
    }
  });

  /** @scenario "A fold is never mounted on this aggregate" */
  it("every projection this pipeline mounts is a map", () => {
    for (const [name, mount] of Object.entries(ALL_MOUNTS)) {
      // A metric data point has no lifetime to accumulate (README /
      // aggregate.ts), so nothing here reads its own prior state back —
      // which is exactly what would make it a fold (ADR-098 §2).
      expect(mount.projection, `${name} projection kind`).toBe("map");
    }
  });
});

describe("group-key determinism (ADR-100)", () => {
  /** @scenario "The same series always lands in the same shard" */
  it("two points of the same series are keyed for the same projection resolve to the same group key", () => {
    const seriesId = "series-shared".repeat(4).slice(0, 64);
    const first = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: METRIC_TIME_ROLLUP_PROJECTION,
      identity: seriesId,
      shardCount: 16,
    });
    const second = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: METRIC_TIME_ROLLUP_PROJECTION,
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
      projectionName: METRIC_DATA_POINT_STORAGE_PROJECTION,
      identity: pointId,
      shardCount: 16,
    });
    const rollupKey = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: METRIC_TIME_ROLLUP_PROJECTION,
      identity: seriesId,
      shardCount: 16,
    });

    expect(storageKey.lane).not.toEqual(rollupKey.lane);
    expect(renderGroupKey(storageKey)).not.toBe(renderGroupKey(rollupKey));
  });

  it("every scope this pipeline declares is partition, so batching is never a no-op", () => {
    // ADR-100 decision 2: `scope: event` can never gather a batch. Every
    // group key this pipeline renders uses `partition`, so its
    // `coalesceMaxBatch` setting is meaningful rather than a silently
    // ignored no-op (the rule `event-scope-cannot-batch` guards).
    const key = metricMapGroupKey({
      tenantId: "tenant-1",
      projectionName: METRIC_DATA_POINT_STORAGE_PROJECTION,
      identity: "any-point-id",
      shardCount: 16,
    });
    expect(key.scope.kind).toBe("partition");
  });
});
