import { createHash } from "node:crypto";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";
import { decodeBase64OpenTelemetryId } from "~/server/tracer/utils";
import type {
  OtlpAnyValue,
  OtlpKeyValue,
} from "../trace-processing/schemas/otlp";
import {
  DEFAULT_METRIC_COMMAND_SHARDS,
  MAX_CANONICAL_METRIC_PAYLOAD_BYTES,
  MAX_METRIC_COMMAND_SHARDS,
  MIN_METRIC_COMMAND_SHARDS,
} from "./schemas/constants";
import type {
  AggregationTemporality,
  CanonicalMetricDataPoint,
  MetricKind,
  MetricTraceCorrelation,
} from "./schemas/metricDataPoint";

type UnknownRecord = Record<string, unknown>;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MIN_INT32 = -(1n << 31n);
const MAX_INT32 = (1n << 31n) - 1n;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

type RedactionService = {
  redactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED",
    tenantId?: string,
  ): Promise<void>;
};

export interface PreparedMetricPoint {
  dataPoint: CanonicalMetricDataPoint;
  correlations: MetricTraceCorrelation[];
}

export interface MetricPreparationResult {
  accepted: PreparedMetricPoint[];
  rejectedDataPoints: number;
  errors: string[];
}

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

/** Deterministic JSON: object keys sort; array order remains meaningful. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === undefined) return { $undefined: true };
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "number" && !Number.isFinite(current)) {
      return { $number: String(current) };
    }
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (isRecord(current)) {
      if (seen.has(current))
        throw new Error("Cannot canonicalize cyclic OTLP data");
      seen.add(current);
      const result: UnknownRecord = {};
      for (const key of Object.keys(current).sort()) {
        result[key] = normalize(current[key]);
      }
      seen.delete(current);
      return result;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function longBitsToBigInt(value: UnknownRecord, signed: boolean): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const highNumber = Number(value.high ?? 0);
  const high = BigInt(highNumber >>> 0);
  const unsigned = (high << 32n) | low;
  return signed ? BigInt.asIntN(64, unsigned) : BigInt.asUintN(64, unsigned);
}

function integerDecimal(
  value: unknown,
  {
    signed = false,
    fallback = "0",
  }: { signed?: boolean; fallback?: string } = {},
): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }
  if (isRecord(value) && "low" in value && "high" in value) {
    return longBitsToBigInt(value, signed).toString();
  }
  return fallback;
}

function checkedInteger(
  value: unknown,
  label: string,
  min: bigint,
  max: bigint,
): bigint {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || !Number.isInteger(value))
  ) {
    throw new Error(`${label} is not a safely represented integer`);
  }
  const decimal = integerDecimal(value, {
    signed: min < 0n,
    fallback: "invalid",
  });
  if (!/^-?\d+$/.test(decimal)) throw new Error(`${label} is not an integer`);
  const parsed = BigInt(decimal);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} is outside its OTLP integer range`);
  }
  return parsed;
}

function timestampDecimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const decimal = integerDecimal(value);
  return /^\d+$/.test(decimal) ? decimal : null;
}

function timestampMs(decimal: string): number {
  const ms = Number(BigInt(decimal) / 1_000_000n);
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new Error(
      `OTLP timestamp is outside the supported Date range: ${decimal}`,
    );
  }
  return ms;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function canonicalAnyValue(
  value: OtlpAnyValue | UnknownRecord | undefined,
): unknown {
  if (!value) return { type: "empty" };
  if (value.stringValue !== undefined && value.stringValue !== null) {
    return { type: "string", value: value.stringValue };
  }
  if (value.boolValue !== undefined && value.boolValue !== null) {
    return {
      type: "bool",
      value:
        typeof value.boolValue === "string"
          ? value.boolValue.toLowerCase() === "true"
          : value.boolValue,
    };
  }
  if (value.intValue !== undefined && value.intValue !== null) {
    return {
      type: "int",
      value: integerDecimal(value.intValue, { signed: true }),
    };
  }
  if (value.doubleValue !== undefined && value.doubleValue !== null) {
    const number = Number(value.doubleValue);
    return {
      type: "double",
      value: Number.isFinite(number) ? number : String(value.doubleValue),
    };
  }
  if (value.bytesValue !== undefined && value.bytesValue !== null) {
    const bytes =
      value.bytesValue instanceof Uint8Array
        ? value.bytesValue
        : typeof value.bytesValue === "string"
          ? Buffer.from(value.bytesValue, "base64")
          : Buffer.from(
              Object.entries(value.bytesValue as UnknownRecord)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, byte]) => Number(byte)),
            );
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (value.arrayValue && isRecord(value.arrayValue)) {
    const values = Array.isArray(value.arrayValue.values)
      ? value.arrayValue.values
      : [];
    return {
      type: "array",
      value: values.map((item) => canonicalAnyValue(item as OtlpAnyValue)),
    };
  }
  if (value.kvlistValue && isRecord(value.kvlistValue)) {
    const values = Array.isArray(value.kvlistValue.values)
      ? (value.kvlistValue.values as OtlpKeyValue[])
      : [];
    return { type: "kvlist", value: canonicalAttributes(values) };
  }
  return { type: "empty" };
}

function canonicalAttributes(
  attributes: unknown,
): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .filter(
      (attribute): attribute is OtlpKeyValue =>
        isRecord(attribute) &&
        typeof attribute.key === "string" &&
        isRecord(attribute.value),
    )
    .map((attribute) => ({
      key: attribute.key,
      value: canonicalAnyValue(attribute.value),
    }))
    .sort((a, b) => {
      const byKey = a.key.localeCompare(b.key);
      return (
        byKey ||
        stableStringify(a.value).localeCompare(stableStringify(b.value))
      );
    });
}

type StringRef = { owner: UnknownRecord; key: string; syntheticKey: string };

function collectStringRefs(
  value: unknown,
  prefix: string,
  out: StringRef[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStringRefs(item, `${prefix}.${index}`, out),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      out.push({ owner: value, key, syntheticKey: path });
    } else {
      collectStringRefs(child, path, out);
    }
  }
}

/** Redacts every nested AnyValue string without flattening its stored type. */
async function redactTypedAttributes(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  pointAttributes: unknown;
  exemplarAttributes: unknown;
  redactionService: RedactionService;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
  tenantId: string;
}): Promise<void> {
  const refs: StringRef[] = [];
  collectStringRefs(args.resourceAttributes, "resource", refs);
  collectStringRefs(args.scopeAttributes, "scope", refs);
  collectStringRefs(args.pointAttributes, "point", refs);
  collectStringRefs(args.exemplarAttributes, "exemplar", refs);
  const attributes = Object.fromEntries(
    refs.map((ref) => [ref.syntheticKey, ref.owner[ref.key] as string]),
  );
  await args.redactionService.redactMetricAttributes(
    { attributes, resourceAttributes: {} },
    args.piiRedactionLevel,
    args.tenantId,
  );
  for (const ref of refs) {
    const redacted = attributes[ref.syntheticKey];
    if (redacted !== undefined) ref.owner[ref.key] = redacted;
  }
}

function metricKind(metric: UnknownRecord): MetricKind | null {
  const kinds: Array<[keyof UnknownRecord, MetricKind]> = [
    ["gauge", "gauge"],
    ["sum", "sum"],
    ["histogram", "histogram"],
    ["exponentialHistogram", "exponential_histogram"],
    ["summary", "summary"],
  ];
  const present = kinds.filter(([key]) => isRecord(metric[key]));
  return present.length === 1 ? present[0]![1] : null;
}

function candidatePointCount(metric: UnknownRecord): number {
  const containers = [
    metric.gauge,
    metric.sum,
    metric.histogram,
    metric.exponentialHistogram,
    metric.summary,
  ];
  const count = containers.reduce<number>((total, container) => {
    if (!isRecord(container) || !Array.isArray(container.dataPoints)) {
      return total;
    }
    return total + container.dataPoints.length;
  }, 0);
  return Math.max(1, count);
}

function aggregation(
  metricData: UnknownRecord,
  kind: MetricKind,
): AggregationTemporality {
  if (kind === "gauge" || kind === "summary") return "unspecified";
  const value = metricData.aggregationTemporality;
  if (value === 1 || String(value).endsWith("DELTA")) return "delta";
  if (value === 2 || String(value).endsWith("CUMULATIVE")) return "cumulative";
  return "unspecified";
}

function canonicalExemplars(exemplars: unknown): unknown[] {
  if (!Array.isArray(exemplars)) return [];
  return exemplars.map((raw) => {
    const exemplar = isRecord(raw) ? raw : {};
    const time = timestampDecimal(exemplar.timeUnixNano) ?? "0";
    const value =
      exemplar.asInt !== undefined
        ? {
            type: "int",
            value: integerDecimal(exemplar.asInt, { signed: true }),
          }
        : { type: "double", value: exemplar.asDouble ?? null };
    return {
      filteredAttributes: canonicalAttributes(exemplar.filteredAttributes),
      timeUnixNano: time,
      value,
      traceId: decodeBase64OpenTelemetryId(exemplar.traceId) ?? "",
      spanId: decodeBase64OpenTelemetryId(exemplar.spanId) ?? "",
    };
  });
}

function validTraceId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value);
}

function validSpanId(value: string): boolean {
  return /^[a-f0-9]{16}$/i.test(value) && !/^0+$/.test(value);
}

function correlations(args: {
  exemplars: unknown;
  tenantId: string;
  pointId: string;
  seriesId: string;
  metricName: string;
  metricUnit: string;
  metricKind: MetricKind;
  occurredAt: number;
}): MetricTraceCorrelation[] {
  if (!Array.isArray(args.exemplars)) return [];
  const unique = new Map<string, MetricTraceCorrelation>();
  for (const raw of args.exemplars) {
    if (!isRecord(raw)) continue;
    const traceId = (
      decodeBase64OpenTelemetryId(raw.traceId) ?? ""
    ).toLowerCase();
    const spanId = (
      decodeBase64OpenTelemetryId(raw.spanId) ?? ""
    ).toLowerCase();
    if (!validTraceId(traceId) || !validSpanId(spanId)) continue;
    const exemplarTime = timestampDecimal(raw.timeUnixNano);
    const exemplarValue = finiteNumber(raw.asDouble ?? raw.asInt);
    const correlationKey = `${traceId}:${spanId}`;
    if (unique.has(correlationKey)) continue;
    unique.set(correlationKey, {
      tenantId: args.tenantId,
      traceId,
      spanId,
      pointId: args.pointId,
      seriesId: args.seriesId,
      metricName: args.metricName,
      metricUnit: args.metricUnit,
      metricKind: args.metricKind,
      exemplarValue,
      exemplarTimeUnixMs: exemplarTime
        ? timestampMs(exemplarTime)
        : args.occurredAt,
      occurredAt: exemplarTime ? timestampMs(exemplarTime) : args.occurredAt,
    });
  }
  return [...unique.values()];
}

function strings(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => integerDecimal(value))
    : [];
}

function numbers(values: unknown): number[] {
  return Array.isArray(values)
    ? values
        .map(finiteNumber)
        .filter((value): value is number => value !== null)
    : [];
}

function canonicalBuckets(value: unknown): {
  offset: number;
  bucketCounts: string[];
} {
  const buckets = isRecord(value) ? value : {};
  return {
    offset: Number(buckets.offset ?? 0),
    bucketCounts: strings(buckets.bucketCounts),
  };
}

function canonicalQuantiles(value: unknown): Array<{
  quantile: number | null;
  value: number | null;
}> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const quantile = isRecord(entry) ? entry : {};
    return {
      quantile: finiteNumber(quantile.quantile),
      value: finiteNumber(quantile.value),
    };
  });
}

function validateExplicitHistogram(point: UnknownRecord): void {
  const count = checkedInteger(point.count, "histogram count", 0n, MAX_UINT64);
  if (!Array.isArray(point.explicitBounds)) {
    throw new Error("histogram explicitBounds must be an array");
  }
  const bounds = point.explicitBounds.map((value) => finiteNumber(value));
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
      checkedInteger(value, `histogram bucketCounts[${index}]`, 0n, MAX_UINT64),
    0n,
  );
  if (bucketTotal !== count) {
    throw new Error("histogram bucketCounts must sum to count");
  }
}

function exponentialBuckets(
  value: unknown,
  label: string,
): { offset: bigint; total: bigint } {
  const buckets = isRecord(value) ? value : {};
  const offset = checkedInteger(
    buckets.offset ?? 0,
    `${label} offset`,
    MIN_INT32,
    MAX_INT32,
  );
  if (!Array.isArray(buckets.bucketCounts)) {
    throw new Error(`${label} bucketCounts must be an array`);
  }
  const total = buckets.bucketCounts.reduce(
    (sum, count, index) =>
      sum +
      checkedInteger(count, `${label} bucketCounts[${index}]`, 0n, MAX_UINT64),
    0n,
  );
  return { offset, total };
}

function validateExponentialHistogram(point: UnknownRecord): void {
  const count = checkedInteger(
    point.count,
    "exponential histogram count",
    0n,
    MAX_UINT64,
  );
  checkedInteger(point.scale ?? 0, "exponential histogram scale", -10n, 20n);
  const zeroThreshold = finiteNumber(point.zeroThreshold ?? 0);
  if (zeroThreshold === null || zeroThreshold < 0) {
    throw new Error(
      "exponential histogram zeroThreshold must be a finite non-negative number",
    );
  }
  const zeroCount = checkedInteger(
    point.zeroCount,
    "exponential histogram zeroCount",
    0n,
    MAX_UINT64,
  );
  const positive = exponentialBuckets(
    point.positive,
    "exponential histogram positive",
  );
  const negative = exponentialBuckets(
    point.negative,
    "exponential histogram negative",
  );
  if (positive.total + negative.total + zeroCount !== count) {
    throw new Error(
      "exponential histogram buckets and zeroCount must sum to count",
    );
  }
}

function validatePointShape(point: UnknownRecord, kind: MetricKind): void {
  if (point.timeUnixNano === undefined || point.timeUnixNano === null) {
    throw new Error("data point is missing timeUnixNano");
  }
  const time = checkedInteger(
    point.timeUnixNano,
    "timeUnixNano",
    0n,
    MAX_UINT64,
  );
  if (time === 0n) throw new Error("data point is missing timeUnixNano");
  if (point.startTimeUnixNano !== undefined) {
    checkedInteger(
      point.startTimeUnixNano,
      "startTimeUnixNano",
      0n,
      MAX_UINT64,
    );
  }
  checkedInteger(point.flags ?? 0, "flags", 0n, MAX_UINT32);

  if (kind === "gauge" || kind === "sum") {
    const hasInt = point.asInt !== undefined && point.asInt !== null;
    const hasDouble = point.asDouble !== undefined && point.asDouble !== null;
    if (hasInt === hasDouble) {
      throw new Error("number data point must contain exactly one value");
    }
    if (hasInt) {
      checkedInteger(point.asInt, "asInt", MIN_INT64, MAX_INT64);
    }
    return;
  }

  if (kind === "histogram") {
    validateExplicitHistogram(point);
    return;
  }
  if (kind === "exponential_histogram") {
    validateExponentialHistogram(point);
    return;
  }

  checkedInteger(point.count, "summary count", 0n, MAX_UINT64);
  if (finiteNumber(point.sum) === null) {
    throw new Error("summary sum must be a finite number");
  }
}

function buildPoint(args: {
  tenantId: string;
  organizationId: string;
  resourceMetric: UnknownRecord;
  scopeMetric: UnknownRecord;
  metric: UnknownRecord;
  metricData: UnknownRecord;
  point: UnknownRecord;
  kind: MetricKind;
  acceptedAt: number;
}): PreparedMetricPoint {
  const { point, metric, metricData, kind } = args;
  validatePointShape(point, kind);
  const timeUnixNano = timestampDecimal(point.timeUnixNano);
  if (!timeUnixNano) throw new Error("data point is missing timeUnixNano");
  const startTimeUnixNano = timestampDecimal(point.startTimeUnixNano) ?? "0";
  const resource = isRecord(args.resourceMetric.resource)
    ? args.resourceMetric.resource
    : {};
  const scope = isRecord(args.scopeMetric.scope) ? args.scopeMetric.scope : {};
  const resourceAttributes = canonicalAttributes(resource.attributes);
  const scopeAttributes = canonicalAttributes(scope.attributes);
  const pointAttributes = canonicalAttributes(point.attributes);
  const temporality = aggregation(metricData, kind);
  const monotonic = kind === "sum" ? Boolean(metricData.isMonotonic) : null;
  const name = typeof metric.name === "string" ? metric.name : "";
  if (!name) throw new Error("metric is missing name");
  const unit = typeof metric.unit === "string" ? metric.unit : "";
  const description =
    typeof metric.description === "string" ? metric.description : "";

  const seriesIdentity = {
    tenantId: args.tenantId,
    resource: {
      schemaUrl:
        typeof args.resourceMetric.schemaUrl === "string"
          ? args.resourceMetric.schemaUrl
          : "",
      attributes: resourceAttributes,
    },
    scope: {
      schemaUrl:
        typeof args.scopeMetric.schemaUrl === "string"
          ? args.scopeMetric.schemaUrl
          : "",
      name: typeof scope.name === "string" ? scope.name : "",
      version: typeof scope.version === "string" ? scope.version : "",
      attributes: scopeAttributes,
    },
    metric: {
      name,
      unit,
      kind,
      aggregationTemporality: temporality,
      isMonotonic: monotonic,
    },
    pointAttributes,
  };
  const seriesId = sha256(stableStringify(seriesIdentity));

  const canonicalPoint = {
    resource: {
      schemaUrl: seriesIdentity.resource.schemaUrl,
      droppedAttributesCount: integerDecimal(resource.droppedAttributesCount),
      attributes: resourceAttributes,
    },
    scope: {
      schemaUrl: seriesIdentity.scope.schemaUrl,
      name: seriesIdentity.scope.name,
      version: seriesIdentity.scope.version,
      droppedAttributesCount: integerDecimal(scope.droppedAttributesCount),
      attributes: scopeAttributes,
    },
    metric: {
      name,
      description,
      unit,
      kind,
      aggregationTemporality: temporality,
      isMonotonic: monotonic,
    },
    point: {
      attributes: pointAttributes,
      startTimeUnixNano,
      timeUnixNano,
      flags: Number(point.flags ?? 0),
      ...(point.asInt !== undefined
        ? {
            value: {
              type: "int",
              value: integerDecimal(point.asInt, { signed: true }),
            },
          }
        : point.asDouble !== undefined
          ? { value: { type: "double", value: point.asDouble } }
          : {}),
      ...(kind === "histogram"
        ? {
            histogram: {
              count: integerDecimal(point.count),
              sum: point.sum ?? null,
              min: point.min ?? null,
              max: point.max ?? null,
              explicitBounds: point.explicitBounds ?? [],
              bucketCounts: strings(point.bucketCounts),
            },
          }
        : {}),
      ...(kind === "exponential_histogram"
        ? {
            exponentialHistogram: {
              count: integerDecimal(point.count),
              sum: point.sum ?? null,
              min: point.min ?? null,
              max: point.max ?? null,
              scale: point.scale ?? 0,
              zeroThreshold: point.zeroThreshold ?? 0,
              zeroCount: integerDecimal(point.zeroCount),
              positive: canonicalBuckets(point.positive),
              negative: canonicalBuckets(point.negative),
            },
          }
        : {}),
      ...(kind === "summary"
        ? {
            summary: {
              count: integerDecimal(point.count),
              sum: point.sum ?? null,
              quantileValues: canonicalQuantiles(point.quantileValues),
            },
          }
        : {}),
      exemplars: canonicalExemplars(point.exemplars),
    },
  };
  const canonicalPayload = stableStringify(canonicalPoint);
  const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
  if (canonicalSizeBytes > MAX_CANONICAL_METRIC_PAYLOAD_BYTES) {
    throw new RangeError(
      `canonical metric payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_METRIC_PAYLOAD_BYTES})`,
    );
  }
  const pointId = sha256(`${seriesId}\0${canonicalPayload}`);
  const positive = isRecord(point.positive) ? point.positive : {};
  const negative = isRecord(point.negative) ? point.negative : {};
  const valueType =
    point.asInt !== undefined
      ? "int"
      : point.asDouble !== undefined
        ? "double"
        : "none";

  const dataPoint: CanonicalMetricDataPoint = {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    pointId,
    seriesId,
    resourceSchemaUrl: seriesIdentity.resource.schemaUrl,
    resourceAttributesJson: stableStringify(resourceAttributes),
    resourceAttributeKeys: [...new Set(resourceAttributes.map((a) => a.key))],
    scopeSchemaUrl: seriesIdentity.scope.schemaUrl,
    scopeName: seriesIdentity.scope.name,
    scopeVersion: seriesIdentity.scope.version,
    scopeAttributesJson: stableStringify(scopeAttributes),
    scopeAttributeKeys: [...new Set(scopeAttributes.map((a) => a.key))],
    metricName: name,
    metricDescription: description,
    metricUnit: unit,
    metricKind: kind,
    aggregationTemporality: temporality,
    isMonotonic: monotonic,
    pointAttributesJson: stableStringify(pointAttributes),
    pointAttributeKeys: [...new Set(pointAttributes.map((a) => a.key))],
    startTimeUnixNano,
    timeUnixNano,
    timeUnixMs: timestampMs(timeUnixNano),
    flags: Number(point.flags ?? 0),
    valueType,
    valueInt:
      valueType === "int"
        ? integerDecimal(point.asInt, { signed: true })
        : null,
    valueDouble: valueType === "double" ? finiteNumber(point.asDouble) : null,
    count:
      kind === "histogram" ||
      kind === "exponential_histogram" ||
      kind === "summary"
        ? integerDecimal(point.count)
        : null,
    sum: finiteNumber(point.sum),
    min: finiteNumber(point.min),
    max: finiteNumber(point.max),
    explicitBounds: numbers(point.explicitBounds),
    bucketCounts: strings(point.bucketCounts),
    exponentialScale:
      kind === "exponential_histogram" ? Number(point.scale ?? 0) : null,
    exponentialZeroThreshold:
      kind === "exponential_histogram"
        ? finiteNumber(point.zeroThreshold ?? 0)
        : null,
    zeroCount:
      kind === "exponential_histogram" ? integerDecimal(point.zeroCount) : null,
    positiveOffset:
      kind === "exponential_histogram" ? Number(positive.offset ?? 0) : null,
    positiveBucketCounts: strings(positive.bucketCounts),
    negativeOffset:
      kind === "exponential_histogram" ? Number(negative.offset ?? 0) : null,
    negativeBucketCounts: strings(negative.bucketCounts),
    summaryQuantilesJson:
      kind === "summary" ? stableStringify(point.quantileValues ?? []) : "[]",
    canonicalPayload,
    canonicalSizeBytes,
    occurredAt: timestampMs(timeUnixNano),
    acceptedAt: args.acceptedAt,
  };

  return {
    dataPoint,
    correlations: correlations({
      exemplars: point.exemplars,
      tenantId: args.tenantId,
      pointId,
      seriesId,
      metricName: name,
      metricUnit: unit,
      metricKind: kind,
      occurredAt: timestampMs(timeUnixNano),
    }),
  };
}

export async function prepareMetricDataPoints(args: {
  tenantId: string;
  organizationId: string;
  request: DeepPartial<IExportMetricsServiceRequest>;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
  redactionService: RedactionService;
  acceptedAt?: number;
}): Promise<MetricPreparationResult> {
  const accepted: PreparedMetricPoint[] = [];
  const errors: string[] = [];
  let rejectedDataPoints = 0;
  const acceptedAt = args.acceptedAt ?? Date.now();

  for (const resourceMetricRaw of args.request.resourceMetrics ?? []) {
    if (!resourceMetricRaw) continue;
    const resourceMetric = structuredClone(resourceMetricRaw) as UnknownRecord;
    const resourceTemplate = isRecord(resourceMetric.resource)
      ? resourceMetric.resource
      : {};
    for (const scopeMetricRaw of (resourceMetric.scopeMetrics as unknown[]) ??
      []) {
      if (!scopeMetricRaw) continue;
      const scopeMetric = structuredClone(scopeMetricRaw) as UnknownRecord;
      const scopeTemplate = isRecord(scopeMetric.scope)
        ? scopeMetric.scope
        : {};
      for (const metricRaw of (scopeMetric.metrics as unknown[]) ?? []) {
        if (!metricRaw) continue;
        const metric = structuredClone(metricRaw) as UnknownRecord;
        const kind = metricKind(metric);
        if (!kind) {
          rejectedDataPoints += candidatePointCount(metric);
          errors.push(
            `metric ${String(metric.name ?? "<unnamed>")} has no single supported data kind`,
          );
          continue;
        }
        const dataKey =
          kind === "exponential_histogram" ? "exponentialHistogram" : kind;
        const metricData = metric[dataKey];
        if (!isRecord(metricData) || !Array.isArray(metricData.dataPoints)) {
          rejectedDataPoints++;
          errors.push(
            `metric ${String(metric.name ?? "<unnamed>")} has malformed dataPoints`,
          );
          continue;
        }
        for (const pointRaw of metricData.dataPoints) {
          if (!isRecord(pointRaw)) {
            rejectedDataPoints++;
            errors.push(
              `metric ${String(metric.name ?? "<unnamed>")} contains a malformed data point`,
            );
            continue;
          }
          const point = structuredClone(pointRaw);
          // Redactors mutate in place. Isolate shared resource/scope identity
          // for every sibling so a non-idempotent policy cannot compound its
          // output and produce different SeriesIds within one OTLP request.
          const resource = structuredClone(resourceTemplate);
          const scope = structuredClone(scopeTemplate);
          try {
            await redactTypedAttributes({
              resourceAttributes: resource.attributes,
              scopeAttributes: scope.attributes,
              pointAttributes: point.attributes,
              exemplarAttributes: point.exemplars,
              redactionService: args.redactionService,
              piiRedactionLevel: args.piiRedactionLevel,
              tenantId: args.tenantId,
            });
            accepted.push(
              buildPoint({
                tenantId: args.tenantId,
                organizationId: args.organizationId,
                resourceMetric: { ...resourceMetric, resource },
                scopeMetric: { ...scopeMetric, scope },
                metric,
                metricData,
                point,
                kind,
                acceptedAt,
              }),
            );
          } catch (error) {
            rejectedDataPoints++;
            errors.push(
              `metric ${String(metric.name ?? "<unnamed>")}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    }
  }
  return { accepted, rejectedDataPoints, errors };
}

export function clampMetricCommandShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_COMMAND_SHARDS;
  return Math.min(
    MAX_METRIC_COMMAND_SHARDS,
    Math.max(MIN_METRIC_COMMAND_SHARDS, Math.trunc(value)),
  );
}

export function resolveMetricCommandShardCount(
  value: string | undefined,
): number {
  if (!value) return DEFAULT_METRIC_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricCommandShardCount(parsed)
    : DEFAULT_METRIC_COMMAND_SHARDS;
}

export function metricCommandGroupKey(
  pointId: string,
  shardCount: number,
): string {
  const count = BigInt(clampMetricCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(pointId).slice(0, 16)}`) % count;
  return `metric:${lane}`;
}
