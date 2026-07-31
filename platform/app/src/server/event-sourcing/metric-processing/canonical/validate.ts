import type { MetricKind } from "../schema";
import {
  checkedInteger,
  checkedOptionalDouble,
  finiteNumber,
  MAX_INT32,
  MAX_INT64,
  MAX_UINT32,
  MAX_UINT64,
  MIN_INT32,
  MIN_INT64,
} from "./numbers";
import { isRecord, type UnknownRecord } from "./serialization";

function validateOptionalDoubles(args: {
  point: UnknownRecord;
  labels: Record<string, string>;
}): void {
  for (const [field, label] of Object.entries(args.labels)) {
    checkedOptionalDouble({ value: args.point[field], label });
  }
}

function validateExplicitHistogram(point: UnknownRecord): void {
  const count = checkedInteger({
    value: point.count,
    label: "histogram count",
    min: 0n,
    max: MAX_UINT64,
  });
  validateOptionalDoubles({
    point,
    labels: {
      sum: "histogram sum",
      min: "histogram min",
      max: "histogram max",
    },
  });
  if (!Array.isArray(point.explicitBounds)) {
    throw new Error("histogram explicitBounds must be an array");
  }
  const bounds = point.explicitBounds.map((value) => finiteNumber(value));
  if (bounds.some((value) => value === null)) {
    throw new Error("histogram explicitBounds must contain finite numbers");
  }
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i]! <= bounds[i - 1]!) {
      throw new Error("histogram explicitBounds must be strictly increasing");
    }
  }
  if (!Array.isArray(point.bucketCounts)) {
    throw new Error("histogram bucketCounts must be an array");
  }
  if (point.bucketCounts.length !== bounds.length + 1) {
    throw new Error(
      "histogram bucketCounts must have exactly one more entry than explicitBounds",
    );
  }
  const bucketTotal = point.bucketCounts.reduce(
    (total, value, index) =>
      total +
      checkedInteger({
        value,
        label: `histogram bucketCounts[${index}]`,
        min: 0n,
        max: MAX_UINT64,
      }),
    0n,
  );
  if (bucketTotal !== count)
    throw new Error("histogram bucketCounts must sum to count");
}

function exponentialBucketTotal(
  value: unknown,
  label: string,
): { offset: bigint; total: bigint } {
  const buckets = isRecord(value) ? value : {};
  const offset = checkedInteger({
    value: buckets.offset ?? 0,
    label: `${label} offset`,
    min: MIN_INT32,
    max: MAX_INT32,
  });
  if (!Array.isArray(buckets.bucketCounts)) {
    throw new Error(`${label} bucketCounts must be an array`);
  }
  const total = buckets.bucketCounts.reduce(
    (sum, count, index) =>
      sum +
      checkedInteger({
        value: count,
        label: `${label} bucketCounts[${index}]`,
        min: 0n,
        max: MAX_UINT64,
      }),
    0n,
  );
  return { offset, total };
}

function validateExponentialHistogram(point: UnknownRecord): void {
  const count = checkedInteger({
    value: point.count,
    label: "exponential histogram count",
    min: 0n,
    max: MAX_UINT64,
  });
  checkedInteger({
    value: point.scale ?? 0,
    label: "exponential histogram scale",
    min: -10n,
    max: 20n,
  });
  validateOptionalDoubles({
    point,
    labels: {
      sum: "exponential histogram sum",
      min: "exponential histogram min",
      max: "exponential histogram max",
    },
  });
  const zeroThreshold = finiteNumber(point.zeroThreshold ?? 0);
  if (zeroThreshold === null || zeroThreshold < 0) {
    throw new Error(
      "exponential histogram zeroThreshold must be a finite non-negative number",
    );
  }
  const zeroCount = checkedInteger({
    value: point.zeroCount,
    label: "exponential histogram zeroCount",
    min: 0n,
    max: MAX_UINT64,
  });
  const positive = exponentialBucketTotal(
    point.positive,
    "exponential histogram positive",
  );
  const negative = exponentialBucketTotal(
    point.negative,
    "exponential histogram negative",
  );
  if (positive.total + negative.total + zeroCount !== count) {
    throw new Error(
      "exponential histogram buckets and zeroCount must sum to count",
    );
  }
}

function validateNumberPoint(point: UnknownRecord): void {
  const hasInt = point.asInt !== undefined && point.asInt !== null;
  const hasDouble = point.asDouble !== undefined && point.asDouble !== null;
  if (hasInt === hasDouble) {
    throw new Error("number data point must contain exactly one value");
  }
  if (hasInt) {
    checkedInteger({
      value: point.asInt,
      label: "asInt",
      min: MIN_INT64,
      max: MAX_INT64,
    });
    return;
  }
  // NaN and +-Infinity normalise to NULL, which would report an accepted
  // point whose stored value is absent — reject instead of silently losing
  // the measurement.
  checkedOptionalDouble({ value: point.asDouble, label: "asDouble" });
}

function validateSummary(point: UnknownRecord): void {
  checkedInteger({
    value: point.count,
    label: "summary count",
    min: 0n,
    max: MAX_UINT64,
  });
  if (finiteNumber(point.sum) === null) {
    throw new Error("summary sum must be a finite number");
  }
}

export function validatePointShape(args: {
  point: UnknownRecord;
  kind: MetricKind;
}): void {
  const { point, kind } = args;
  if (point.timeUnixNano === undefined || point.timeUnixNano === null) {
    throw new Error("data point is missing timeUnixNano");
  }
  const time = checkedInteger({
    value: point.timeUnixNano,
    label: "timeUnixNano",
    min: 0n,
    max: MAX_UINT64,
  });
  if (time === 0n) throw new Error("data point is missing timeUnixNano");
  if (point.startTimeUnixNano !== undefined) {
    checkedInteger({
      value: point.startTimeUnixNano,
      label: "startTimeUnixNano",
      min: 0n,
      max: MAX_UINT64,
    });
  }
  checkedInteger({
    value: point.flags ?? 0,
    label: "flags",
    min: 0n,
    max: MAX_UINT32,
  });

  if (kind === "gauge" || kind === "sum") return validateNumberPoint(point);
  if (kind === "histogram") return validateExplicitHistogram(point);
  if (kind === "exponential_histogram")
    return validateExponentialHistogram(point);
  return validateSummary(point);
}
