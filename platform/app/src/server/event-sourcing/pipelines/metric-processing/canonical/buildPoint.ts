import { decodeBase64OpenTelemetryId } from "~/server/tracer/utils";
import { MAX_CANONICAL_METRIC_PAYLOAD_BYTES } from "../schemas/constants";
import type {
  CanonicalMetricDataPoint,
  MetricKind,
  MetricTraceCorrelation,
} from "../schemas/metricDataPoint";
import { canonicalAttributes } from "./attributes";
import { correlations } from "./correlations";
import { aggregation } from "./kinds";
import { integerDecimal, timestampDecimal, timestampMs } from "./numbers";
import {
  isRecord,
  sha256,
  stableStringify,
  type UnknownRecord,
} from "./serialization";
import { validatePointShape } from "./validate";
import { canonicalPointValues, canonicalValueSection } from "./values";

export interface PreparedMetricPoint {
  dataPoint: CanonicalMetricDataPoint;
  correlations: MetricTraceCorrelation[];
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

function uniqueKeys(attributes: Array<{ key: string }>): string[] {
  return [...new Set(attributes.map((attribute) => attribute.key))];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireTimeUnixNano(point: UnknownRecord): string {
  const timeUnixNano = timestampDecimal(point.timeUnixNano);
  if (!timeUnixNano) throw new Error("data point is missing timeUnixNano");
  return timeUnixNano;
}

function requireMetricName(metric: UnknownRecord): string {
  const name = stringField(metric.name);
  if (!name) throw new Error("metric is missing name");
  return name;
}

function buildSeriesIdentity({
  tenantId,
  resourceSchemaUrl,
  resourceAttributes,
  scopeSchemaUrl,
  scopeName,
  scopeVersion,
  scopeAttributes,
  name,
  unit,
  kind,
  temporality,
  monotonic,
  pointAttributes,
}: {
  tenantId: string;
  resourceSchemaUrl: string;
  resourceAttributes: ReturnType<typeof canonicalAttributes>;
  scopeSchemaUrl: string;
  scopeName: string;
  scopeVersion: string;
  scopeAttributes: ReturnType<typeof canonicalAttributes>;
  name: string;
  unit: string;
  kind: MetricKind;
  temporality: ReturnType<typeof aggregation>;
  monotonic: boolean | null;
  pointAttributes: ReturnType<typeof canonicalAttributes>;
}) {
  return {
    tenantId,
    resource: {
      schemaUrl: resourceSchemaUrl,
      attributes: resourceAttributes,
    },
    scope: {
      schemaUrl: scopeSchemaUrl,
      name: scopeName,
      version: scopeVersion,
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
}

function buildCanonicalPoint({
  seriesIdentity,
  resource,
  scope,
  name,
  description,
  unit,
  kind,
  temporality,
  monotonic,
  pointAttributes,
  startTimeUnixNano,
  timeUnixNano,
  flags,
  values,
  exemplars,
}: {
  seriesIdentity: ReturnType<typeof buildSeriesIdentity>;
  resource: UnknownRecord;
  scope: UnknownRecord;
  name: string;
  description: string;
  unit: string;
  kind: MetricKind;
  temporality: ReturnType<typeof aggregation>;
  monotonic: boolean | null;
  pointAttributes: ReturnType<typeof canonicalAttributes>;
  startTimeUnixNano: string;
  timeUnixNano: string;
  flags: number;
  values: ReturnType<typeof canonicalPointValues>;
  exemplars: unknown;
}) {
  return {
    resource: {
      schemaUrl: seriesIdentity.resource.schemaUrl,
      droppedAttributesCount: integerDecimal(resource.droppedAttributesCount),
      attributes: seriesIdentity.resource.attributes,
    },
    scope: {
      schemaUrl: seriesIdentity.scope.schemaUrl,
      name: seriesIdentity.scope.name,
      version: seriesIdentity.scope.version,
      droppedAttributesCount: integerDecimal(scope.droppedAttributesCount),
      attributes: seriesIdentity.scope.attributes,
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
      flags,
      ...canonicalValueSection({ values, kind }),
      exemplars: canonicalExemplars(exemplars),
    },
  };
}

function assertCanonicalPayloadSize(canonicalSizeBytes: number): void {
  if (canonicalSizeBytes > MAX_CANONICAL_METRIC_PAYLOAD_BYTES) {
    throw new RangeError(
      `canonical metric payload is ${canonicalSizeBytes} bytes (maximum ${MAX_CANONICAL_METRIC_PAYLOAD_BYTES})`,
    );
  }
}

function assembleDataPoint({
  tenantId,
  organizationId,
  acceptedAt,
  pointId,
  seriesId,
  seriesIdentity,
  resourceAttributes,
  scopeAttributes,
  pointAttributes,
  name,
  description,
  unit,
  kind,
  temporality,
  monotonic,
  startTimeUnixNano,
  timeUnixNano,
  occurredAt,
  flags,
  values,
  canonicalPayload,
  canonicalSizeBytes,
}: {
  tenantId: string;
  organizationId: string;
  acceptedAt: number;
  pointId: string;
  seriesId: string;
  seriesIdentity: ReturnType<typeof buildSeriesIdentity>;
  resourceAttributes: ReturnType<typeof canonicalAttributes>;
  scopeAttributes: ReturnType<typeof canonicalAttributes>;
  pointAttributes: ReturnType<typeof canonicalAttributes>;
  name: string;
  description: string;
  unit: string;
  kind: MetricKind;
  temporality: ReturnType<typeof aggregation>;
  monotonic: boolean | null;
  startTimeUnixNano: string;
  timeUnixNano: string;
  occurredAt: number;
  flags: number;
  values: ReturnType<typeof canonicalPointValues>;
  canonicalPayload: string;
  canonicalSizeBytes: number;
}): CanonicalMetricDataPoint {
  return {
    tenantId,
    organizationId,
    pointId,
    seriesId,
    resourceSchemaUrl: seriesIdentity.resource.schemaUrl,
    resourceAttributesJson: stableStringify(resourceAttributes),
    resourceAttributeKeys: uniqueKeys(resourceAttributes),
    scopeSchemaUrl: seriesIdentity.scope.schemaUrl,
    scopeName: seriesIdentity.scope.name,
    scopeVersion: seriesIdentity.scope.version,
    scopeAttributesJson: stableStringify(scopeAttributes),
    scopeAttributeKeys: uniqueKeys(scopeAttributes),
    metricName: name,
    metricDescription: description,
    metricUnit: unit,
    metricKind: kind,
    aggregationTemporality: temporality,
    isMonotonic: monotonic,
    pointAttributesJson: stableStringify(pointAttributes),
    pointAttributeKeys: uniqueKeys(pointAttributes),
    startTimeUnixNano,
    timeUnixNano,
    timeUnixMs: occurredAt,
    flags,
    valueType: values.valueType,
    valueInt: values.valueInt,
    valueDouble: values.valueDouble,
    count: values.count,
    sum: values.sum,
    min: values.min,
    max: values.max,
    explicitBounds: values.explicitBounds,
    bucketCounts: values.bucketCounts,
    exponentialScale: values.exponentialScale,
    exponentialZeroThreshold: values.exponentialZeroThreshold,
    zeroCount: values.zeroCount,
    positiveOffset: values.positiveOffset,
    positiveBucketCounts: values.positiveBucketCounts,
    negativeOffset: values.negativeOffset,
    negativeBucketCounts: values.negativeBucketCounts,
    summaryQuantilesJson: stableStringify(values.quantileValues),
    canonicalPayload,
    canonicalSizeBytes,
    occurredAt,
    acceptedAt,
  };
}

interface BuildPointArgs {
  tenantId: string;
  organizationId: string;
  resourceMetric: UnknownRecord;
  scopeMetric: UnknownRecord;
  metric: UnknownRecord;
  metricData: UnknownRecord;
  point: UnknownRecord;
  kind: MetricKind;
  acceptedAt: number;
}

function derivePointFields(args: BuildPointArgs) {
  const { point, metric, metricData, kind } = args;

  const timeUnixNano = requireTimeUnixNano(point);
  const startTimeUnixNano = timestampDecimal(point.startTimeUnixNano) ?? "0";
  const occurredAt = timestampMs(timeUnixNano);

  const name = requireMetricName(metric);
  const unit = stringField(metric.unit);
  const description = stringField(metric.description);

  const resource = isRecord(args.resourceMetric.resource)
    ? args.resourceMetric.resource
    : {};
  const scope = isRecord(args.scopeMetric.scope) ? args.scopeMetric.scope : {};
  const resourceAttributes = canonicalAttributes(resource.attributes);
  const scopeAttributes = canonicalAttributes(scope.attributes);
  const pointAttributes = canonicalAttributes(point.attributes);
  const temporality = aggregation({ metricData, kind });
  const monotonic = kind === "sum" ? Boolean(metricData.isMonotonic) : null;
  const values = canonicalPointValues({ point, kind });
  const flags = Number(point.flags ?? 0);

  const seriesIdentity = buildSeriesIdentity({
    tenantId: args.tenantId,
    resourceSchemaUrl: stringField(args.resourceMetric.schemaUrl),
    resourceAttributes,
    scopeSchemaUrl: stringField(args.scopeMetric.schemaUrl),
    scopeName: stringField(scope.name),
    scopeVersion: stringField(scope.version),
    scopeAttributes,
    name,
    unit,
    kind,
    temporality,
    monotonic,
    pointAttributes,
  });

  return {
    resource,
    scope,
    name,
    unit,
    description,
    resourceAttributes,
    scopeAttributes,
    pointAttributes,
    kind,
    temporality,
    monotonic,
    values,
    flags,
    startTimeUnixNano,
    timeUnixNano,
    occurredAt,
    seriesIdentity,
  };
}

/**
 * Turns one validated OTLP data point into its canonical, lossless form:
 * a stable SeriesId over the identity fields, a PointId over the full
 * canonical payload, and the queryable columns rendered from that same payload.
 */
export function buildPoint(args: BuildPointArgs): PreparedMetricPoint {
  validatePointShape({ point: args.point, kind: args.kind });
  const fields = derivePointFields(args);
  const seriesId = sha256(stableStringify(fields.seriesIdentity));

  const canonicalPoint = buildCanonicalPoint({
    ...fields,
    exemplars: args.point.exemplars,
  });
  const canonicalPayload = stableStringify(canonicalPoint);
  const canonicalSizeBytes = Buffer.byteLength(canonicalPayload, "utf8");
  assertCanonicalPayloadSize(canonicalSizeBytes);
  const pointId = sha256(`${seriesId}\0${canonicalPayload}`);

  const dataPoint = assembleDataPoint({
    ...fields,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    acceptedAt: args.acceptedAt,
    pointId,
    seriesId,
    canonicalPayload,
    canonicalSizeBytes,
  });

  return {
    dataPoint,
    correlations: correlations({
      exemplars: args.point.exemplars,
      tenantId: args.tenantId,
      pointId,
      seriesId,
      metricName: fields.name,
      metricUnit: fields.unit,
      metricKind: fields.kind,
      occurredAt: fields.occurredAt,
    }),
  };
}
