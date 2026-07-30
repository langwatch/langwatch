import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { metric } from "../aggregate";
import {
  createMetricSeriesCatalogProjection,
  metricSeriesCatalogGroupKey,
} from "../projections/metricSeriesCatalog";
import {
  createMetricTimeRollupProjection,
  metricTimeRollupGroupKey,
} from "../projections/metricTimeRollup";
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

describe("metricSeriesCatalog", () => {
  it("passes the event's canonical point through to the store untouched", async () => {
    const { store, batches } = recordingStore();
    const projection = createMetricSeriesCatalogProjection({ store });
    const canonical = point({ timeUnixMs: 1_000 });

    const outcome = await projection.apply({
      tenantId: canonical.tenantId,
      events: [metric.events.dataPointReceived(canonical)],
    });

    expect(outcome.written).toBe(1);
    expect(batches[0]![0]).toEqual(canonical);
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
    const { store, batches } = recordingStore();
    const projection = createMetricTimeRollupProjection({ store });
    const canonical = point({ timeUnixMs: 1_000, valueDouble: 0 });

    const outcome = await projection.apply({
      tenantId: canonical.tenantId,
      events: [metric.events.dataPointReceived(canonical)],
    });

    expect(outcome.written).toBe(1);
    expect(batches[0]![0]!.valueDouble).toBe(0);
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

    // Different lane *names* (different projections), same shard label —
    // both serialise on the series, just in their own projection's lane.
    expect(rollupKey.scope).toEqual(catalogKey.scope);
    expect(rollupKey.lane).not.toEqual(catalogKey.lane);
  });
});
