import { describe, expect, it } from "vitest";
import { createMetricProcessingPipeline } from "../index";
import { createFakeClient, insertedCell } from "./fakeClient";
import { point } from "./fixtures";

describe("the built metric-processing pipeline", () => {
  it("names itself 'metric', matching the persisted AggregateType already in event_log", () => {
    const built = createMetricProcessingPipeline({
      client: createFakeClient(),
    });
    expect(built.name).toBe("metric");
  });

  it("derives the dotted event type string already persisted in event_log", () => {
    const built = createMetricProcessingPipeline({
      client: createFakeClient(),
    });
    expect([...built.eventTypes]).toEqual([
      "lw.obs.metric.data_point_received",
    ]);
  });

  it("stamps a command's emitted event with the pipeline's derived persisted type", async () => {
    const built = createMetricProcessingPipeline({
      client: createFakeClient(),
    });
    const canonical = point({ timeUnixMs: 1_000 });
    const emitted = await built.commands.recordDataPoint!.handle(canonical, {
      now: Date.now(),
      tenantId: "tenant-a",
    });
    expect(emitted).toEqual([
      { type: "lw.obs.metric.data_point_received", data: canonical },
    ]);
  });

  it("is asserted at composition rather than on the first delivery", () => {
    expect(() =>
      createMetricProcessingPipeline({ client: createFakeClient() }),
    ).not.toThrow();
  });

  it("mounts exactly the three maps and the one command this aggregate declares", () => {
    const built = createMetricProcessingPipeline({
      client: createFakeClient(),
    });
    expect(Object.keys(built.maps).sort()).toEqual(
      [
        "metricDataPointStorage",
        "metricSeriesCatalog",
        "metricTimeRollup",
      ].sort(),
    );
    expect(Object.keys(built.commands)).toEqual(["recordDataPoint"]);
    expect(built.folds).toEqual({});
  });
});

describe("the metricDataPointStorage map", () => {
  it("writes one metric_data_points row per event, mapped from the point's own fields", async () => {
    const client = createFakeClient();
    const built = createMetricProcessingPipeline({ client });
    const canonical = point({ timeUnixMs: 1_000, valueDouble: 7 });

    const outcome = await built.maps.metricDataPointStorage!.apply({
      tenantId: canonical.tenantId,
      events: [{ type: "lw.obs.metric.data_point_received", data: canonical }],
    });

    expect(outcome.written).toBe(1);
    expect(client.insertCalls.map((call) => call.table)).toEqual([
      "metric_data_points",
    ]);
    expect(
      insertedCell({ client, table: "metric_data_points", column: "PointId" }),
    ).toBe(canonical.pointId);
    expect(
      insertedCell({
        client,
        table: "metric_data_points",
        column: "ValueDouble",
      }),
    ).toBe(7);
  });

  it("targets a replacing table, so ADR-104 lets a failed insert be retried", async () => {
    const client = createFakeClient();
    const built = createMetricProcessingPipeline({ client });
    await built.maps.metricDataPointStorage!.apply({
      tenantId: "project-1",
      events: [
        {
          type: "lw.obs.metric.data_point_received",
          data: point({ timeUnixMs: 1_000 }),
        },
      ],
    });
    expect(client.insertCalls[0]!.target).toEqual({ kind: "replacing" });
  });
});

describe("metricSeriesCatalog", () => {
  it("writes one metric_series row per series, not one per point", async () => {
    const client = createFakeClient();
    const built = createMetricProcessingPipeline({ client });
    const first = point({ timeUnixMs: 1_000, pointId: "1".padStart(64, "0") });
    const second = point({ timeUnixMs: 5_000, pointId: "2".padStart(64, "0") });

    const outcome = await built.maps.metricSeriesCatalog!.apply({
      tenantId: first.tenantId,
      events: [first, second].map((p) => ({
        type: "lw.obs.metric.data_point_received",
        data: p,
      })),
    });

    expect(outcome.written).toBe(2);
    const call = client.insertCalls.find((c) => c.table === "metric_series")!;
    expect(call.rows).toHaveLength(1);
  });
});

describe("metricTimeRollup", () => {
  it("recomputes the affected bucket from the authoritative points and writes it whole", async () => {
    const client = createFakeClient();
    const built = createMetricProcessingPipeline({ client });
    const stored = point({ timeUnixMs: 1_000, valueDouble: 0 });
    client.stored = [stored];

    const outcome = await built.maps.metricTimeRollup!.apply({
      tenantId: stored.tenantId,
      events: [{ type: "lw.obs.metric.data_point_received", data: stored }],
    });

    expect(outcome.written).toBe(1);
    const call = client.insertCalls.find(
      (c) => c.table === "metric_time_rollups",
    )!;
    expect(call.rows).toHaveLength(1);
  });
});

describe("every projection on this pipeline", () => {
  it("ignores an event type the pipeline never declared", async () => {
    const client = createFakeClient();
    const built = createMetricProcessingPipeline({ client });

    const outcome = await built.maps.metricDataPointStorage!.apply({
      tenantId: "t1",
      events: [{ type: "lw.obs.metric.something_else", data: {} }],
    });

    expect(outcome).toEqual({ written: 0 });
    expect(client.insertCalls).toHaveLength(0);
  });
});
