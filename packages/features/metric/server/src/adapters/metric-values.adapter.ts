import type { MetricKind } from "@langwatch/metric-contract";
import { MetricNumbersAdapter } from "./metric-numbers.adapter";
import { type UnknownRecord } from "./metric-serialization.adapter";
import { MetricSerializationAdapter } from "./metric-serialization.adapter";
const { isRecord } = MetricSerializationAdapter;

/**
 * The canonical view of every value-carrying OTLP field, in the exact form the
 * queryable columns store. The canonical payload that produces PointId is
 * rendered from this same view, so a point's identity can never disagree with
 * its own persisted content.
 */
export interface CanonicalPointValues {
  valueType: "none" | "int" | "double";
  valueInt: string | null;
  valueDouble: number | null;
  count: string | null;
  sum: number | null;
  min: number | null;
  max: number | null;
  explicitBounds: number[];
  bucketCounts: string[];
  exponentialScale: number | null;
  exponentialZeroThreshold: number | null;
  zeroCount: string | null;
  positiveOffset: number | null;
  positiveBucketCounts: string[];
  negativeOffset: number | null;
  negativeBucketCounts: string[];
  quantileValues: Array<{ quantile: number | null; value: number | null }>;
}

function canonicalQuantiles(value: unknown): CanonicalPointValues["quantileValues"] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const quantile = isRecord(entry) ? entry : {};
    return {
      quantile: MetricNumbersAdapter.finiteNumber(quantile.quantile),
      value: MetricNumbersAdapter.finiteNumber(quantile.value),
    };
  });
}

function canonicalPointValues({
  point,
  kind,
}: {
  point: UnknownRecord;
  kind: MetricKind;
}): CanonicalPointValues {
  const positive = isRecord(point.positive) ? point.positive : {};
  const negative = isRecord(point.negative) ? point.negative : {};
  const isExponential = kind === "exponential_histogram";
  const isCounted = kind === "histogram" || isExponential || kind === "summary";
  // Only gauges and sums carry a scalar, and presence matches the validator's:
  // an explicit null means absent, so a `{ asInt: null, asDouble: 5 }` point
  // stays a double rather than becoming an int zero.
  const isScalar = kind === "gauge" || kind === "sum";
  const hasInt = isScalar && point.asInt !== undefined && point.asInt !== null;
  const hasDouble = isScalar && point.asDouble !== undefined && point.asDouble !== null;
  const valueType = hasInt ? "int" : hasDouble ? "double" : "none";

  return {
    valueType,
    valueInt: hasInt ? MetricNumbersAdapter.integerDecimal(point.asInt, { signed: true }) : null,
    valueDouble: hasDouble ? MetricNumbersAdapter.finiteNumber(point.asDouble) : null,
    count: isCounted ? MetricNumbersAdapter.integerDecimal(point.count) : null,
    sum: MetricNumbersAdapter.finiteNumber(point.sum),
    min: MetricNumbersAdapter.finiteNumber(point.min),
    max: MetricNumbersAdapter.finiteNumber(point.max),
    explicitBounds: MetricNumbersAdapter.finiteNumbers(point.explicitBounds),
    bucketCounts: MetricNumbersAdapter.integerDecimals(point.bucketCounts),
    exponentialScale: isExponential ? Number(point.scale ?? 0) : null,
    exponentialZeroThreshold: isExponential
      ? MetricNumbersAdapter.finiteNumber(point.zeroThreshold ?? 0)
      : null,
    zeroCount: isExponential ? MetricNumbersAdapter.integerDecimal(point.zeroCount) : null,
    positiveOffset: isExponential ? Number(positive.offset ?? 0) : null,
    positiveBucketCounts: MetricNumbersAdapter.integerDecimals(positive.bucketCounts),
    negativeOffset: isExponential ? Number(negative.offset ?? 0) : null,
    negativeBucketCounts: MetricNumbersAdapter.integerDecimals(negative.bucketCounts),
    quantileValues: kind === "summary" ? canonicalQuantiles(point.quantileValues) : [],
  };
}

/** The payload's value section, rendered from the same canonical view. */
function canonicalValueSection({
  values,
  kind,
}: {
  values: CanonicalPointValues;
  kind: MetricKind;
}): UnknownRecord {
  if (kind === "gauge" || kind === "sum") {
    if (values.valueType === "none") return {};
    return {
      value:
        values.valueType === "int"
          ? { type: "int", value: values.valueInt }
          : { type: "double", value: values.valueDouble },
    };
  }
  if (kind === "histogram") {
    return {
      histogram: {
        count: values.count,
        sum: values.sum,
        min: values.min,
        max: values.max,
        explicitBounds: values.explicitBounds,
        bucketCounts: values.bucketCounts,
      },
    };
  }
  if (kind === "exponential_histogram") {
    return {
      exponentialHistogram: {
        count: values.count,
        sum: values.sum,
        min: values.min,
        max: values.max,
        scale: values.exponentialScale,
        zeroThreshold: values.exponentialZeroThreshold,
        zeroCount: values.zeroCount,
        positive: {
          offset: values.positiveOffset,
          bucketCounts: values.positiveBucketCounts,
        },
        negative: {
          offset: values.negativeOffset,
          bucketCounts: values.negativeBucketCounts,
        },
      },
    };
  }
  return {
    summary: {
      count: values.count,
      sum: values.sum,
      quantileValues: values.quantileValues,
    },
  };
}

export class MetricValuesAdapter {
  private constructor() {}

  static create(): MetricValuesAdapter {
    return new MetricValuesAdapter();
  }

  static canonicalPointValues = canonicalPointValues;
  static canonicalValueSection = canonicalValueSection;
}
