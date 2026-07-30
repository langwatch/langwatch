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

/**
 * Turns one validated OTLP data point into its canonical, lossless form:
 * a stable SeriesId over the identity fields, a PointId over the full
 * canonical payload, and the queryable columns rendered from that same payload.
 */
export function buildPoint(args: {
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
  validatePointShape({ point, kind });

  const timeUnixNano = timestampDecimal(point.timeUnixNano);
  if (!timeUnixNano) throw new Error("data point is missing timeUnixNano");
  const startTimeUnixNano = timestampDecimal(point.startTimeUnixNano) ?? "0";
  const occurredAt = timestampMs(timeUnixNano);

  const name = typeof metric.name === "string" ? metric.name : "";
  if (!name) throw new Error("metric is missing name");
  const unit = typeof metric.unit === "string" ? metric.unit : "";
  const description =
    typeof metric.description === "string" ? metric.description : "";

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
      flags,
      ...canonicalValueSection({ values, kind }),
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

  const dataPoint: CanonicalMetricDataPoint = {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
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
      occurredAt,
    }),
  };
}
