import type { MetricKind } from "@langwatch/metric-contract";
import {
  MAX_INT32,
  MAX_INT64,
  MAX_UINT32,
  MAX_UINT64,
  MetricNumbersAdapter,
  MIN_INT32,
  MIN_INT64,
} from "./metric-numbers.adapter";
import { type UnknownRecord } from "./metric-serialization.adapter";
import { MetricSerializationAdapter } from "./metric-serialization.adapter";
const { isRecord } = MetricSerializationAdapter;

/**
 * Whether a metric point's shape matches the kind it claims to be.
 *
 * A histogram with mismatched bucket and bound counts, or a summary with
 * quantiles out of order, is not a point that can be stored and read back as
 * what it says it is. Checked once here, on the way in.
 */
export class MetricValidationAdapter {
  private constructor() {}

  static create(): MetricValidationAdapter {
    return new MetricValidationAdapter();
  }

  /**
   * Every optional double a kind can carry. A present-but-unrepresentable value
   * would be stored as NULL on an accepted point, so it is rejected here.
   */
  private static validateOptionalDoubles({
    point,
    labels,
  }: {
    point: UnknownRecord;
    labels: Record<string, string>;
  }): void {
    for (const [field, label] of Object.entries(labels)) {
      MetricNumbersAdapter.checkedOptionalDouble({ value: point[field], label });
    }
  }

  private static validateExplicitHistogram(point: UnknownRecord): void {
    const count = MetricNumbersAdapter.checkedInteger({
      value: point.count,
      label: "histogram count",
      min: 0n,
      max: MAX_UINT64,
    });
    MetricValidationAdapter.validateOptionalDoubles({
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
    const bounds = point.explicitBounds.map((value) => MetricNumbersAdapter.finiteNumber(value));
    if (bounds.some((value) => value === null)) {
      throw new Error("histogram explicitBounds must contain finite numbers");
    }
    for (let index = 1; index < bounds.length; index++) {
      if (bounds[index]! <= bounds[index - 1]!) {
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
        MetricNumbersAdapter.checkedInteger({
          value,
          label: `histogram bucketCounts[${index}]`,
          min: 0n,
          max: MAX_UINT64,
        }),
      0n,
    );
    if (bucketTotal !== count) {
      throw new Error("histogram bucketCounts must sum to count");
    }
  }

  private static exponentialBuckets({ value, label }: { value: unknown; label: string }): {
    offset: bigint;
    total: bigint;
  } {
    const buckets = isRecord(value) ? value : {};
    const offset = MetricNumbersAdapter.checkedInteger({
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
        MetricNumbersAdapter.checkedInteger({
          value: count,
          label: `${label} bucketCounts[${index}]`,
          min: 0n,
          max: MAX_UINT64,
        }),
      0n,
    );
    return { offset, total };
  }

  private static validateExponentialHistogram(point: UnknownRecord): void {
    const count = MetricNumbersAdapter.checkedInteger({
      value: point.count,
      label: "exponential histogram count",
      min: 0n,
      max: MAX_UINT64,
    });
    MetricNumbersAdapter.checkedInteger({
      value: point.scale ?? 0,
      label: "exponential histogram scale",
      min: -10n,
      max: 20n,
    });
    MetricValidationAdapter.validateOptionalDoubles({
      point,
      labels: {
        sum: "exponential histogram sum",
        min: "exponential histogram min",
        max: "exponential histogram max",
      },
    });
    const zeroThreshold = MetricNumbersAdapter.finiteNumber(point.zeroThreshold ?? 0);
    if (zeroThreshold === null || zeroThreshold < 0) {
      throw new Error("exponential histogram zeroThreshold must be a finite non-negative number");
    }
    const zeroCount = MetricNumbersAdapter.checkedInteger({
      value: point.zeroCount,
      label: "exponential histogram zeroCount",
      min: 0n,
      max: MAX_UINT64,
    });
    const positive = MetricValidationAdapter.exponentialBuckets({
      value: point.positive,
      label: "exponential histogram positive",
    });
    const negative = MetricValidationAdapter.exponentialBuckets({
      value: point.negative,
      label: "exponential histogram negative",
    });
    if (positive.total + negative.total + zeroCount !== count) {
      throw new Error("exponential histogram buckets and zeroCount must sum to count");
    }
  }

  private static validateNumberPoint(point: UnknownRecord): void {
    const hasInt = point.asInt !== undefined && point.asInt !== null;
    const hasDouble = point.asDouble !== undefined && point.asDouble !== null;
    if (hasInt === hasDouble) {
      throw new Error("number data point must contain exactly one value");
    }
    if (hasInt) {
      MetricNumbersAdapter.checkedInteger({
        value: point.asInt,
        label: "asInt",
        min: MIN_INT64,
        max: MAX_INT64,
      });
      return;
    }
    // NaN and ±Infinity normalize to NULL, which would report an accepted point
    // whose stored value is absent. Reject instead so the sender learns.
    MetricNumbersAdapter.checkedOptionalDouble({ value: point.asDouble, label: "asDouble" });
  }

  private static validateSummary(point: UnknownRecord): void {
    MetricNumbersAdapter.checkedInteger({
      value: point.count,
      label: "summary count",
      min: 0n,
      max: MAX_UINT64,
    });
    if (MetricNumbersAdapter.finiteNumber(point.sum) === null) {
      throw new Error("summary sum must be a finite number");
    }
  }

  static validatePointShape({ point, kind }: { point: UnknownRecord; kind: MetricKind }): void {
    if (point.timeUnixNano === undefined || point.timeUnixNano === null) {
      throw new Error("data point is missing timeUnixNano");
    }
    const time = MetricNumbersAdapter.checkedInteger({
      value: point.timeUnixNano,
      label: "timeUnixNano",
      min: 0n,
      max: MAX_UINT64,
    });
    if (time === 0n) throw new Error("data point is missing timeUnixNano");
    if (point.startTimeUnixNano !== undefined) {
      MetricNumbersAdapter.checkedInteger({
        value: point.startTimeUnixNano,
        label: "startTimeUnixNano",
        min: 0n,
        max: MAX_UINT64,
      });
    }
    MetricNumbersAdapter.checkedInteger({
      value: point.flags ?? 0,
      label: "flags",
      min: 0n,
      max: MAX_UINT32,
    });

    if (kind === "gauge" || kind === "sum")
      return MetricValidationAdapter.validateNumberPoint(point);
    if (kind === "histogram") return MetricValidationAdapter.validateExplicitHistogram(point);
    if (kind === "exponential_histogram") {
      return MetricValidationAdapter.validateExponentialHistogram(point);
    }
    return MetricValidationAdapter.validateSummary(point);
  }
}
