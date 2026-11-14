/** @vitest-environment node */

/**
 * ADR-202 slice 8: the built successor, bucket-range and far-predecessor reads return the rows the
 * hand-written statements they replaced returned, on a migrated server, with a second tenant
 * holding the same series ids. The raw texts are the pre-port statements, kept as fixtures.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import {
  METRIC_ROLLUP_INTERVAL_MS,
  type CanonicalMetricDataPoint,
  type MetricSequencePoint,
} from "@langwatch/metric-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { point } from "../../../app/__tests__/metric.fixture.ts";
import { ClickHouseMetricDataPointAppendRepository } from "../clickhouse.metric-data-point-append.repository.ts";
import {
  bucketRangeStatement,
  farPredecessorStatement,
  type SeekSpan,
  successorSeekStatement,
} from "../clickhouse.metric-data-point-query.mapper.ts";
import {
  metricPointFromSeekRow,
  seekMetricRowSchema,
} from "../clickhouse.metric-data-point.mapper.ts";

const tag = randomUUID();
const tenantA = `${tag}-a`;
const tenantB = `${tag}-b`;
const seriesOne = "1".repeat(64);
const seriesTwo = "2".repeat(64);
const base =
  Math.floor((Date.now() - 20 * 60_000) / METRIC_ROLLUP_INTERVAL_MS) * METRIC_ROLLUP_INTERVAL_MS;

const SEEK_SELECT = `SeriesId, PointId,
  toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs, TimeUnixNano,
  MetricKind, AggregationTemporality`;

const ordered = (
  op: "<" | ">",
  bound: "From" | "To",
) => `(series_points.SeekTime ${op} spans.Span${bound}Time
   OR (series_points.SeekTime = spans.Span${bound}Time
     AND (series_points.TimeUnixNano ${op} spans.Span${bound}Nano
       OR (series_points.TimeUnixNano = spans.Span${bound}Nano
         AND series_points.PointId ${op} spans.Span${bound}Point))))`;

const RAW_SUCCESSOR_SEEK = `
  WITH spans AS (
    SELECT span.1 AS SpanSeriesId, fromUnixTimestamp64Milli(span.2) AS SpanFromTime,
      toUInt64(span.3) AS SpanFromNano, span.4 AS SpanFromPoint,
      fromUnixTimestamp64Milli(span.5) AS SpanToTime, toUInt64(span.6) AS SpanToNano,
      span.7 AS SpanToPoint
    FROM (SELECT arrayJoin(arrayZip(
      {seriesIds:Array(String)},
      {fromTimes:Array(Int64)}, {fromNanos:Array(String)}, {fromPoints:Array(String)},
      {toTimes:Array(Int64)}, {toNanos:Array(String)}, {toPoints:Array(String)}
    )) AS span)
  ),
  series_points AS (
    SELECT ${SEEK_SELECT}, metric_data_points.TimeUnixMs AS SeekTime
    FROM metric_data_points
    WHERE TenantId = {tenantId:String}
      AND SeriesId IN {seriesIds:Array(String)}
      AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({scanFrom:Int64})
  )
  SELECT * FROM (
    (SELECT series_points.*
     FROM series_points INNER JOIN spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId
     WHERE series_points.SeekTime <= fromUnixTimestamp64Milli({latestSpanEnd:Int64})
       AND ${ordered(">", "From")} AND ${ordered("<", "To")})
    UNION ALL
    (SELECT series_points.*
     FROM series_points INNER JOIN spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId
     WHERE series_points.SeekTime >= fromUnixTimestamp64Milli({earliestSpanEnd:Int64})
       AND ${ordered(">", "To")}
     ORDER BY series_points.SeriesId ASC, series_points.SeekTime ASC,
       series_points.TimeUnixNano ASC, series_points.PointId ASC
     LIMIT 1 BY SeriesId)
  )`;

const rawBucketRange = (count: number) => `SELECT ${SEEK_SELECT}
  FROM metric_data_points
  WHERE TenantId = {tenantId:String}
    AND (${Array.from(
      { length: count },
      (_, i) => `(SeriesId = {series${i}:String}
      AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${i}:Int64} - {lookbackMs:Int64})
      AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({to${i}:Int64} + {bucketMs:Int64}))`,
    ).join(" OR ")})`;

const rawFarPredecessor = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `(SELECT ${SEEK_SELECT}
      FROM metric_data_points
      WHERE TenantId = {tenantId:String} AND SeriesId = {series${i}:String}
        AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({from${i}:Int64} - {lookbackToMs:Int64})
        AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${i}:Int64} - {lookbackFromMs:Int64})
      ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`,
  ).join("\n UNION ALL\n");

let ch: ClickHouseClient;

function seeded({ tenantId, offsetMs }: { tenantId: string; offsetMs: number }) {
  const at = (seriesId: string, timeUnixMs: number, pointId?: string): CanonicalMetricDataPoint =>
    point({ tenantId, seriesId, timeUnixMs, ...(pointId ? { pointId } : {}) });
  const one = Array.from({ length: 12 }, (_, k) => at(seriesOne, base + offsetMs + k * 10_000));
  const two = Array.from({ length: 6 }, (_, k) => at(seriesTwo, base + offsetMs + k * 15_000));
  // Two more points sharing a millisecond with a stored one: the nano and point tiebreaks decide.
  const tied = [
    at(seriesOne, base + offsetMs + 40_000, `${"0".repeat(63)}1`),
    at(seriesOne, base + offsetMs + 40_000, "f".repeat(64)),
  ];
  return { one, two, all: [...one, ...two, ...tied] };
}

const a = seeded({ tenantId: tenantA, offsetMs: 0 });
const b = seeded({ tenantId: tenantB, offsetMs: 5_000 });

async function rawRows(query: string, params: Record<string, unknown>) {
  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = (await result.json()) as Record<string, unknown>[];
  return sorted(
    rows.map(({ TimeUnixMs, ...row }) => seekMetricRowSchema.parse({ ...row, TimeMs: TimeUnixMs })),
  );
}

async function builtRows(
  statement: Parameters<ReturnType<typeof vendorQueryClient>["read"]>[0]["statement"],
) {
  const { rows } = await vendorQueryClient({ vendor: ch, indexes: [] }).read({ statement });
  return sorted(rows.map((row) => seekMetricRowSchema.parse(row)));
}

function sorted(rows: Parameters<typeof metricPointFromSeekRow>[0][]): MetricSequencePoint[] {
  return rows
    .map(metricPointFromSeekRow)
    .toSorted((x, y) =>
      `${x.seriesId}${String(x.timeUnixMs).padStart(16, "0")}${x.timeUnixNano.padStart(20, "0")}${x.pointId}`.localeCompare(
        `${y.seriesId}${String(y.timeUnixMs).padStart(16, "0")}${y.timeUnixNano.padStart(20, "0")}${y.pointId}`,
      ),
    );
}

beforeAll(async () => {
  ({ client: ch } = await startMigratedClickHouse());
  const repository = ClickHouseMetricDataPointAppendRepository.create({
    resolveClient: async () => ({
      insert: async (params) => {
        await ch.insert(params);
      },
      read: (input) => vendorQueryClient({ vendor: ch, indexes: [] }).read(input),
    }),
    defaultRetentionDays: 30,
  });
  await repository.ensureDataPoints({ points: a.all });
  await repository.ensureDataPoints({ points: b.all });
}, 240_000);

afterAll(async () => {
  for (const tenantId of [tenantA, tenantB]) {
    await deleteMigratedTenantRows({
      client: ch,
      tenantId,
      tables: ["metric_data_points", "metric_usage_estimates"],
    });
  }
});

describe("given two tenants holding the same series ids on a migrated server", () => {
  /** @scenario "The built seek reads return the rows the hand-written reads returned" */
  it("returns the successor rows the raw successor seek returned, for one tenant only", async () => {
    const span = (
      points: CanonicalMetricDataPoint[],
      seriesId: string,
      from: number,
      to: number,
    ): SeekSpan => ({
      seriesId,
      first: points[from]!,
      last: points[to]!,
    });
    const spans = [span(a.one, seriesOne, 2, 5), span(a.two, seriesTwo, 1, 3)];
    const raw = await rawRows(RAW_SUCCESSOR_SEEK, {
      tenantId: tenantA,
      seriesIds: spans.map((s) => s.seriesId),
      fromTimes: spans.map((s) => s.first.timeUnixMs),
      fromNanos: spans.map((s) => s.first.timeUnixNano),
      fromPoints: spans.map((s) => s.first.pointId),
      toTimes: spans.map((s) => s.last.timeUnixMs),
      toNanos: spans.map((s) => s.last.timeUnixNano),
      toPoints: spans.map((s) => s.last.pointId),
      scanFrom: Math.min(...spans.map((s) => s.first.timeUnixMs)),
      earliestSpanEnd: Math.min(...spans.map((s) => s.last.timeUnixMs)),
      latestSpanEnd: Math.max(...spans.map((s) => s.last.timeUnixMs)),
    });
    const built = await builtRows(successorSeekStatement({ tenantId: tenantA, spans }));

    expect(raw.length).toBeGreaterThan(4);
    expect(built).toEqual(raw);
  });

  /** @scenario "The built seek reads return the rows the hand-written reads returned" */
  it("returns the bucket-range rows the raw OR'd key ranges returned", async () => {
    const lookbackMs = 20_000;
    const ranges = [
      { seriesId: seriesOne, from: base + 30_000, to: base + 60_000 },
      { seriesId: seriesTwo, from: base + 30_000, to: base + 30_000 },
    ];
    const params: Record<string, unknown> = {
      tenantId: tenantA,
      bucketMs: METRIC_ROLLUP_INTERVAL_MS,
      lookbackMs,
    };
    ranges.forEach(({ seriesId, from, to }, i) => {
      params[`series${i}`] = seriesId;
      params[`from${i}`] = from;
      params[`to${i}`] = to;
    });
    const raw = await rawRows(rawBucketRange(ranges.length), params);
    const built = await builtRows(bucketRangeStatement({ tenantId: tenantA, lookbackMs, ranges }));

    expect(raw.length).toBeGreaterThan(4);
    expect(built).toEqual(raw);
  });

  /** @scenario "The built seek reads return the rows the hand-written reads returned" */
  it("returns the far-predecessor rows the raw reverse seeks returned, an empty seek included", async () => {
    const seeks = [
      { seriesId: seriesOne, start: base + 60_000 },
      { seriesId: seriesTwo, start: base + 90_000 },
      { seriesId: seriesOne, start: base },
    ] as const;
    const predecessor = { fromMs: 3_600_000, toMs: 25_000 };
    const params: Record<string, unknown> = {
      tenantId: tenantA,
      lookbackFromMs: predecessor.fromMs,
      lookbackToMs: predecessor.toMs,
    };
    seeks.forEach(({ seriesId, start }, i) => {
      params[`series${i}`] = seriesId;
      params[`from${i}`] = start;
    });
    const raw = await rawRows(rawFarPredecessor(seeks.length), params);
    const built = await builtRows(
      farPredecessorStatement({ tenantId: tenantA, seeks: [...seeks], predecessor }),
    );

    expect(raw).toHaveLength(2);
    expect(built).toEqual(raw);
  });
});
