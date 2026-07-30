import type { MetricKind } from "../schema";
import {
  finiteNumber,
  finiteNumbers,
  integerDecimal,
  integerDecimals,
} from "./numbers";
import { isRecord, type UnknownRecord } from "./serialization";

/**
 * The canonical view of every value-carrying OTLP field, in the exact form the
 * queryable row stores. PointId hashes a payload rendered from this same view,
 * so a point's identity can never disagree with its persisted content.
 *
 * A data point whose value is `0` is a real observation, so `hasInt`/`hasDouble`
 * test `!== undefined && !== null`; a falsy check here is how a real zero
 * silently becomes "no value was sent".
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

function canonicalQuantiles(
  value: unknown,
): CanonicalPointValues["quantileValues"] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const quantile = isRecord(entry) ? entry : {};
    return {
      quantile: finiteNumber(quantile.quantile),
      value: finiteNumber(quantile.value),
    };
  });
}

export function canonicalPointValues(args: {
  point: UnknownRecord;
  kind: MetricKind;
}): CanonicalPointValues {
  const { point, kind } = args;
  const positive = isRecord(point.positive) ? point.positive : {};
  const negative = isRecord(point.negative) ? point.negative : {};
  const isExponential = kind === "exponential_histogram";
  const isCounted = kind === "histogram" || isExponential || kind === "summary";
  const isScalar = kind === "gauge" || kind === "sum";

  // See the zero-value contract above: `!== undefined && !== null`, never a
  // truthiness test, is what lets `{ asInt: 0 }` and `{ asDouble: 0 }` report
  // as present rather than falling through to "none".
  const hasInt = isScalar && point.asInt !== undefined && point.asInt !== null;
  const hasDouble =
    isScalar && point.asDouble !== undefined && point.asDouble !== null;
  const valueType: CanonicalPointValues["valueType"] = hasInt
    ? "int"
    : hasDouble
      ? "double"
      : "none";

  return {
    valueType,
    valueInt: hasInt ? integerDecimal(point.asInt, { signed: true }) : null,
    valueDouble: hasDouble ? finiteNumber(point.asDouble) : null,
    count: isCounted ? integerDecimal(point.count) : null,
    sum: finiteNumber(point.sum),
    min: finiteNumber(point.min),
    max: finiteNumber(point.max),
    explicitBounds: finiteNumbers(point.explicitBounds),
    bucketCounts: integerDecimals(point.bucketCounts),
    exponentialScale: isExponential ? Number(point.scale ?? 0) : null,
    exponentialZeroThreshold: isExponential
      ? finiteNumber(point.zeroThreshold ?? 0)
      : null,
    zeroCount: isExponential ? integerDecimal(point.zeroCount) : null,
    positiveOffset: isExponential ? Number(positive.offset ?? 0) : null,
    positiveBucketCounts: integerDecimals(positive.bucketCounts),
    negativeOffset: isExponential ? Number(negative.offset ?? 0) : null,
    negativeBucketCounts: integerDecimals(negative.bucketCounts),
    quantileValues:
      kind === "summary" ? canonicalQuantiles(point.quantileValues) : [],
  };
}

/** The payload's value section, rendered from the same canonical view. */
export function canonicalValueSection(args: {
  values: CanonicalPointValues;
  kind: MetricKind;
}): UnknownRecord {
  const { values, kind } = args;
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
