import { METRIC_ROLLUP_INTERVAL_MS, type MetricSequencePoint } from "@langwatch/metric-contract";
import { describe, expect, it } from "vitest";

import {
  type BucketReadRange,
  type BucketSeek,
  bucketReadRanges,
  newestVersions,
  payloadWindows,
  pointsForBucketSeeks,
} from "../metric-rollup-bucket-reads.rules.ts";

const HOUR = 60 * 60 * 1000;
const B = METRIC_ROLLUP_INTERVAL_MS;
const base = Math.floor(1_789_654_800_000 / B) * B;

function stored({
  seriesId,
  timeUnixMs,
  nanoOffset = 0n,
  pointId,
}: {
  seriesId: string;
  timeUnixMs: number;
  nanoOffset?: bigint;
  pointId: string;
}): MetricSequencePoint {
  return {
    seriesId,
    pointId: pointId.padStart(8, "0"),
    timeUnixMs,
    timeUnixNano: String(BigInt(timeUnixMs) * 1_000_000n + nanoOffset),
    metricKind: "sum",
    aggregationTemporality: "cumulative",
  };
}

/** Points on every edge the old per-bucket seeks drew, plus ties the ORDER BY had to break. */
const table: MetricSequencePoint[] = [
  // Series a: dense around three adjacent buckets and one bucket two hours on.
  stored({ seriesId: "a", timeUnixMs: base - HOUR - 1, pointId: "a00" }),
  stored({ seriesId: "a", timeUnixMs: base - HOUR, pointId: "a01" }),
  stored({ seriesId: "a", timeUnixMs: base - 5_000, pointId: "a02" }),
  stored({ seriesId: "a", timeUnixMs: base - 1, pointId: "a03" }),
  stored({ seriesId: "a", timeUnixMs: base - 1, nanoOffset: 500n, pointId: "a04" }),
  stored({ seriesId: "a", timeUnixMs: base - 1, nanoOffset: 500n, pointId: "a05" }),
  stored({ seriesId: "a", timeUnixMs: base, pointId: "a06" }),
  stored({ seriesId: "a", timeUnixMs: base + 10_000, pointId: "a07" }),
  stored({ seriesId: "a", timeUnixMs: base + B, pointId: "a08" }),
  stored({ seriesId: "a", timeUnixMs: base + 2 * B + 29_999, pointId: "a09" }),
  stored({ seriesId: "a", timeUnixMs: base + 3 * B, pointId: "a10" }),
  stored({ seriesId: "a", timeUnixMs: base + 30 * B, pointId: "a11" }),
  stored({ seriesId: "a", timeUnixMs: base + 2 * HOUR - 10, pointId: "a12" }),
  stored({ seriesId: "a", timeUnixMs: base + 2 * HOUR + 1, pointId: "a13" }),
  stored({ seriesId: "a", timeUnixMs: base + 2 * HOUR + B, pointId: "a14" }),
  // Series b: a bucket with nothing in its lookback, and one with only an old predecessor.
  stored({ seriesId: "b", timeUnixMs: base - 3 * HOUR, pointId: "b00" }),
  stored({ seriesId: "b", timeUnixMs: base + 5, pointId: "b01" }),
  stored({ seriesId: "b", timeUnixMs: base + 4 * HOUR + 7, pointId: "b02" }),
  // Series c: never asked about, shares every timestamp with a.
  stored({ seriesId: "c", timeUnixMs: base - 1, pointId: "c00" }),
  stored({ seriesId: "c", timeUnixMs: base + 10_000, pointId: "c01" }),
];

const seeks: BucketSeek[] = [
  { seriesId: "a", start: base },
  { seriesId: "a", start: base + B },
  { seriesId: "a", start: base + 2 * B },
  { seriesId: "a", start: base + 2 * HOUR },
  { seriesId: "b", start: base },
  { seriesId: "b", start: base + 4 * HOUR },
];

function storedDescending(left: MetricSequencePoint, right: MetricSequencePoint): number {
  if (left.timeUnixMs !== right.timeUnixMs) return right.timeUnixMs - left.timeUnixMs;
  const leftNano = BigInt(left.timeUnixNano);
  const rightNano = BigInt(right.timeUnixNano);
  if (leftNano !== rightNano) return leftNano > rightNano ? -1 : 1;
  return right.pointId < left.pointId ? -1 : 1;
}

/** The two sub-selects the UNION ALL issued per bucket, evaluated over the fixture table. */
function oldSeek({
  seriesId,
  start,
  lookbackMs,
}: BucketSeek & { lookbackMs: number }): MetricSequencePoint[] {
  const ofSeries = table.filter((point) => point.seriesId === seriesId);
  const predecessor = ofSeries
    .filter((point) => point.timeUnixMs < start && point.timeUnixMs >= start - lookbackMs)
    .toSorted(storedDescending)
    .slice(0, 1);
  const inBucket = ofSeries.filter(
    (point) => point.timeUnixMs >= start && point.timeUnixMs < start + B,
  );
  return [...predecessor, ...inBucket];
}

/** The new statement's WHERE, evaluated over the fixture table. */
function rangeRead({
  ranges,
  lookbackMs,
}: {
  ranges: readonly BucketReadRange[];
  lookbackMs: number;
}): MetricSequencePoint[] {
  return table.filter((point) =>
    ranges.some(
      (range) =>
        range.seriesId === point.seriesId &&
        point.timeUnixMs >= range.from - lookbackMs &&
        point.timeUnixMs < range.to + B,
    ),
  );
}

function ids(points: readonly MetricSequencePoint[]): string[] {
  return [...new Set(points.map((point) => `${point.seriesId}/${point.pointId}`))].toSorted();
}

describe("pointsForBucketSeeks", () => {
  describe("given rows read by merged range instead of a seek per bucket", () => {
    for (const lookbackMs of [HOUR, 10_000]) {
      const ranges = bucketReadRanges({ seeks, lookbackMs });
      const read = rangeRead({ ranges, lookbackMs });

      it(`returns the rows each old per-bucket seek returned (lookback ${lookbackMs} ms)`, () => {
        for (const seek of seeks) {
          expect(ids(pointsForBucketSeeks({ seeks: [seek], points: read, lookbackMs }))).toEqual(
            ids(oldSeek({ ...seek, lookbackMs })),
          );
        }
      });

      it(`returns the same union the UNION ALL returned (lookback ${lookbackMs} ms)`, () => {
        expect(ids(pointsForBucketSeeks({ seeks, points: read, lookbackMs }))).toEqual(
          ids(seeks.flatMap((seek) => oldSeek({ ...seek, lookbackMs }))),
        );
      });
    }
  });

  describe("given two stored points tied on millisecond and nanosecond", () => {
    it("takes the larger point id as the predecessor, as the ORDER BY did", () => {
      const picked = pointsForBucketSeeks({
        seeks: [{ seriesId: "a", start: base }],
        points: table.filter((point) => point.timeUnixMs < base),
        lookbackMs: HOUR,
      });
      expect(ids(picked)).toEqual(["a/00000a05"]);
    });
  });
});

/** The old far pass: the last point anywhere before the near lookback. */
function farSeek({ seriesId, start }: BucketSeek): MetricSequencePoint[] {
  return table
    .filter((point) => point.seriesId === seriesId && point.timeUnixMs < start - HOUR)
    .toSorted(storedDescending)
    .slice(0, 1);
}

describe("payloadWindows", () => {
  describe("given keys picked by the near and far passes", () => {
    const picked = [
      ...pointsForBucketSeeks({
        seeks,
        points: rangeRead({
          ranges: bucketReadRanges({ seeks, lookbackMs: HOUR }),
          lookbackMs: HOUR,
        }),
        lookbackMs: HOUR,
      }),
      ...seeks
        .filter((seek) =>
          oldSeek({ ...seek, lookbackMs: HOUR }).every((p) => p.timeUnixMs >= seek.start),
        )
        .flatMap(farSeek),
    ];
    const pickedIds = new Set(ids(picked));
    const windows = payloadWindows({ seeks, picked });
    const payload = table.filter(
      (point) =>
        pickedIds.has(`${point.seriesId}/${point.pointId}`) &&
        windows.some(
          (window) =>
            window.seriesId === point.seriesId &&
            point.timeUnixMs >= window.from &&
            point.timeUnixMs < window.to,
        ),
    );

    it("reads back every row the old near and far seeks returned, and only those", () => {
      const old = seeks.flatMap((seek) => {
        const near = oldSeek({ ...seek, lookbackMs: HOUR });
        const hasPredecessor = near.some((point) => point.timeUnixMs < seek.start);
        return hasPredecessor ? near : [...farSeek(seek), ...near];
      });
      expect(ids(payload)).toEqual(ids(old));
    });

    it("starts each window at its predecessor's millisecond, so only its ties are extra", () => {
      expect(windows.filter((window) => window.seriesId === "b")).toEqual([
        { seriesId: "b", from: base - 3 * HOUR, to: base + 4 * HOUR + B },
      ]);
      const covered = table.filter((point) =>
        windows.some(
          (window) =>
            window.seriesId === point.seriesId &&
            point.timeUnixMs >= window.from &&
            point.timeUnixMs < window.to,
        ),
      );
      const extra = covered.filter((point) => !pickedIds.has(`${point.seriesId}/${point.pointId}`));
      expect(ids(extra)).toEqual(["a/00000a03", "a/00000a04"]);
    });
  });
});

describe("newestVersions", () => {
  describe("given unmerged versions of the same point", () => {
    it("keeps the highest dedup version, as FINAL did", () => {
      const [first] = table;
      const rows = [
        { point: { ...first!, metricKind: "old" }, version: 5n },
        { point: { ...first!, metricKind: "new" }, version: 9n },
        { point: { ...first!, metricKind: "older" }, version: 1n },
        { point: { ...table[1]!, metricKind: "other" }, version: 1n },
      ];
      expect(newestVersions({ rows }).map((point) => point.metricKind)).toEqual(["new", "other"]);
    });
  });
});

describe("bucketReadRanges", () => {
  describe("given buckets whose read windows touch", () => {
    it("reads each series as one range per run of touching windows", () => {
      expect(bucketReadRanges({ seeks, lookbackMs: HOUR })).toEqual([
        { seriesId: "a", from: base, to: base + 2 * B },
        { seriesId: "a", from: base + 2 * HOUR, to: base + 2 * HOUR },
        { seriesId: "b", from: base, to: base },
        { seriesId: "b", from: base + 4 * HOUR, to: base + 4 * HOUR },
      ]);
    });
  });

  describe("given windows that only just touch", () => {
    it("merges them, so no row is read twice", () => {
      const start = base + HOUR + B;
      expect(
        bucketReadRanges({
          seeks: [
            { seriesId: "a", start: base },
            { seriesId: "a", start },
          ],
          lookbackMs: HOUR,
        }),
      ).toEqual([{ seriesId: "a", from: base, to: start }]);
    });
  });
});
