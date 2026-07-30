import { describe, expect, it } from "vitest";
import { createMetricProcessingPipeline, metricSeriesCatalogGroupKey } from "../index";
import { metricSeriesTable } from "../table";
import { createFakeClient, insertedCell } from "./fakeClient";
import { point } from "./fixtures";

function pipeline() {
  const client = createFakeClient();
  return { client, built: createMetricProcessingPipeline({ client }) };
}

function received(p: ReturnType<typeof point>) {
  return { type: "lw.obs.metric.data_point_received", data: p };
}

describe("metricDataPointStorage", () => {
  it("writes one metric_data_points row per event, mapped from the point's own fields", async () => {
    const { client, built } = pipeline();
    const canonical = point({ timeUnixMs: 1_000, valueDouble: 7 });

    const outcome = await built.maps.metricDataPointStorage!.apply({
      tenantId: canonical.tenantId,
      events: [received(canonical)],
    });

    expect(outcome.written).toBe(1);
    expect(client.insertCalls.map((call) => call.table)).toEqual(["metric_data_points"]);
    expect(insertedCell({ client, table: "metric_data_points", column: "PointId" })).toBe(
      canonical.pointId,
    );
    expect(insertedCell({ client, table: "metric_data_points", column: "ValueDouble" })).toBe(7);
  });

  it("targets a replacing table, so ADR-104 lets a failed insert be retried", async () => {
    const { client, built } = pipeline();
    await built.maps.metricDataPointStorage!.apply({
      tenantId: "project-1",
      events: [received(point({ timeUnixMs: 1_000 }))],
    });
    expect(client.insertCalls[0]!.target).toEqual({ kind: "replacing" });
  });
});

describe("metricSeriesCatalog", () => {
  it("writes one metric_series row per series, not one per point", async () => {
    const { client, built } = pipeline();
    const first = point({ timeUnixMs: 1_000, pointId: "1".padStart(64, "0") });
    const second = point({ timeUnixMs: 5_000, pointId: "2".padStart(64, "0") });

    const outcome = await built.maps.metricSeriesCatalog!.apply({
      tenantId: first.tenantId,
      events: [first, second].map(received),
    });

    expect(outcome.written).toBe(2);
    const call = client.insertCalls.find((c) => c.table === "metric_series")!;
    expect(call.rows).toHaveLength(1);
  });

  it("keeps the newest observation's LastSeenAt, which is the engine's version", async () => {
    const { client, built } = pipeline();
    const older = point({ timeUnixMs: 1_000, pointId: "1".padStart(64, "0") });
    const newer = point({ timeUnixMs: 5_000, pointId: "2".padStart(64, "0") });

    await built.maps.metricSeriesCatalog!.apply({
      tenantId: older.tenantId,
      events: [newer, older].map(received),
    });

    const cell = insertedCell({ client, table: "metric_series", column: "LastSeenAt" });
    // Compared through the same column codec the store writes with, rather
    // than a wire string spelled out a second time here.
    expect(cell).toBe(
      metricSeriesTable.columns.LastSeenAt.encode(new Date(newer.timeUnixMs)),
    );
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

    expect(
      metricSeriesCatalogGroupKey({ tenantId: "t1", point: b, shardCount: 16 }),
    ).toEqual(metricSeriesCatalogGroupKey({ tenantId: "t1", point: a, shardCount: 16 }));
  });
});

describe("metricTimeRollup", () => {
  it("recomputes the affected bucket from the authoritative points and writes it whole", async () => {
    const { client, built } = pipeline();
    const stored = point({ timeUnixMs: 1_000, valueDouble: 0 });
    client.stored = [stored];

    const outcome = await built.maps.metricTimeRollup!.apply({
      tenantId: stored.tenantId,
      events: [received(stored)],
    });

    expect(outcome.written).toBe(1);
    const call = client.insertCalls.find((c) => c.table === "metric_time_rollups")!;
    expect(call.rows).toHaveLength(1);
    expect(insertedCell({ client, table: "metric_time_rollups", column: "Count" })).toBe("1");
  });

  it("reads the points back through bound identifiers, never an interpolated name", async () => {
    const { client, built } = pipeline();
    const stored = point({ timeUnixMs: 1_000, valueDouble: 1 });
    client.stored = [stored];

    await built.maps.metricTimeRollup!.apply({
      tenantId: stored.tenantId,
      events: [received(stored)],
    });

    expect(client.queries.length).toBeGreaterThan(0);
    for (const sql of client.queries) {
      expect(sql).not.toContain("metric_data_points");
      expect(sql).toMatch(/\{id\d+:Identifier\}/);
    }
  });
});

describe("every projection on this aggregate", () => {
  it("ignores an event type the aggregate never declared", async () => {
    const { client, built } = pipeline();

    const outcome = await built.maps.metricDataPointStorage!.apply({
      tenantId: "t1",
      events: [{ type: "lw.obs.metric.something_else", data: {} }],
    });

    expect(outcome).toEqual({ written: 0 });
    expect(client.insertCalls).toHaveLength(0);
  });
});
