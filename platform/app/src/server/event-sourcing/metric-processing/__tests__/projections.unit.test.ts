import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { metric } from "../aggregate";
import {
  createMetricProcessingProjections,
  metricSeriesCatalogGroupKey,
  metricTimeRollupGroupKey,
} from "../index";
import type { CanonicalMetricDataPoint } from "../schema";
import { point } from "./fixtures";

function recordingStore(): {
  store: AppendStore<CanonicalMetricDataPoint>;
  batches: CanonicalMetricDataPoint[][];
} {
  const batches: CanonicalMetricDataPoint[][] = [];
  return {
    batches,
    store: {
      kind: "append",
      async writeBatch(
        records: readonly CanonicalMetricDataPoint[],
        _context: BatchContext,
      ) {
        batches.push([...records]);
      },
    },
  };
}

function projections() {
  const dataPoints = recordingStore();
  const catalog = recordingStore();
  const rollup = recordingStore();
  return {
    dataPoints,
    catalog,
    rollup,
    executors: createMetricProcessingProjections({
      metricDataPointStore: dataPoints.store,
      metricSeriesCatalogStore: catalog.store,
      metricTimeRollupStore: rollup.store,
    }),
  };
}

describe("metricSeriesCatalog", () => {
  it("passes the event's canonical point through to the store untouched", async () => {
    const { catalog, executors } = projections();
    const canonical = point({ timeUnixMs: 1_000 });

    const outcome = await executors.metricSeriesCatalog.apply({
      tenantId: canonical.tenantId,
      events: [metric.events.dataPointReceived(canonical)],
    });

    expect(outcome.written).toBe(1);
    expect(catalog.batches[0]![0]).toEqual(canonical);
  });

  it("keys its group by seriesId, not pointId", () => {
    const a = point({
      timeUnixMs: 1_000,
      pointId: "1".padStart(64, "0"),
      seriesId: "shared".repeat(11).slice(0, 64),
    });
    const b = point({
      timeUnixMs: 2_000,
      pointId: "2".padStart(64, "0"),
      seriesId: a.seriesId,
    });

    const keyA = metricSeriesCatalogGroupKey({
      tenantId: "t1",
      point: a,
      shardCount: 16,
    });
    const keyB = metricSeriesCatalogGroupKey({
      tenantId: "t1",
      point: b,
      shardCount: 16,
    });

    expect(keyB).toEqual(keyA);
  });
});

describe("metricTimeRollup", () => {
  it("passes the event's canonical point through to the store untouched", async () => {
    const { rollup, executors } = projections();
    const canonical = point({ timeUnixMs: 1_000, valueDouble: 0 });

    const outcome = await executors.metricTimeRollup.apply({
      tenantId: canonical.tenantId,
      events: [metric.events.dataPointReceived(canonical)],
    });

    expect(outcome.written).toBe(1);
    expect(rollup.batches[0]![0]!.valueDouble).toBe(0);
  });

  it("keys its group by seriesId, matching metricSeriesCatalog's serialisation unit", () => {
    const p = point({ timeUnixMs: 1_000 });
    const rollupKey = metricTimeRollupGroupKey({
      tenantId: "t1",
      point: p,
      shardCount: 16,
    });
    const catalogKey = metricSeriesCatalogGroupKey({
      tenantId: "t1",
      point: p,
      shardCount: 16,
    });

    // Different lane *names* (different projections), same shard label — both
    // serialise on the series, just in their own projection's lane.
    expect(rollupKey.scope).toEqual(catalogKey.scope);
    expect(rollupKey.lane).not.toEqual(catalogKey.lane);
  });
});

describe("every projection on this aggregate", () => {
  it("ignores an event type the aggregate never declared", async () => {
    const { dataPoints, executors } = projections();

    const outcome = await executors.metricDataPointStorage.apply({
      tenantId: "t1",
      events: [{ type: "lw.obs.metric.something_else", data: {} }],
    });

    expect(outcome).toEqual({ written: 0 });
    expect(dataPoints.batches).toHaveLength(0);
  });
});
