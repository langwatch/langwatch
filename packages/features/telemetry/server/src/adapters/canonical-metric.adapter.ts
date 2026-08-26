import { buildPoint, type PreparedMetricPoint } from "./metric-build-point.adapter";
import { z } from "zod";
import {
  TelemetryMetricPreparationPort,
  type TelemetryMetricPreparationInput,
} from "../ports/telemetry-preparation.port";
import {
  candidatePointCount,
  METRIC_KIND_DATA_KEY,
  metricKind,
} from "./metric-kinds.adapter";
import {
  type PiiRedactionLevel,
  type RedactionService,
  redactTypedAttributes,
} from "./metric-redaction.adapter";
import { isRecord, type UnknownRecord } from "./metric-serialization.adapter";

const unknownRecordSchema = z.record(z.string(), z.unknown());
const exportMetricsRequestSchema = z
  .object({ resourceMetrics: z.unknown().optional() })
  .passthrough();

export interface MetricPreparationResult {
  accepted: PreparedMetricPoint[];
  rejectedDataPoints: number;
  errors: string[];
}

/** Collects controlled rejections so one bad point never fails its siblings. */
class RejectionLog {
  count = 0;
  readonly messages: string[] = [];

  reject(message: string, points = 1): void {
    this.count += points;
    this.messages.push(message);
  }
}

/**
 * OTLP containers arrive as untrusted JSON, where `resourceMetrics` may be any
 * shape. A non-array is rejected in place rather than thrown past the per-point
 * catch, which would abort the whole request instead of reporting the failure.
 */
function containerArray({
  value,
  label,
  rejections,
}: {
  value: unknown;
  label: string;
  rejections: RejectionLog;
}): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    rejections.reject(`${label} must be an array`);
    return [];
  }
  return value;
}

async function prepareMetric({
  metric,
  resourceMetric,
  scopeMetric,
  args,
  acceptedAt,
  accepted,
  rejections,
}: {
  metric: UnknownRecord;
  resourceMetric: UnknownRecord;
  scopeMetric: UnknownRecord;
  args: PrepareMetricDataPointsArgs;
  acceptedAt: number;
  accepted: PreparedMetricPoint[];
  rejections: RejectionLog;
}): Promise<void> {
  const label = String(metric.name ?? "<unnamed>");
  const kind = metricKind(metric);
  if (!kind) {
    rejections.reject(
      `metric ${label} has no single supported data kind`,
      candidatePointCount(metric),
    );
    return;
  }
  const metricData = metric[METRIC_KIND_DATA_KEY[kind]];
  if (!isRecord(metricData) || !Array.isArray(metricData.dataPoints)) {
    rejections.reject(`metric ${label} has malformed dataPoints`);
    return;
  }

  const resourceTemplate = isRecord(resourceMetric.resource)
    ? resourceMetric.resource
    : {};
  const scopeTemplate = isRecord(scopeMetric.scope) ? scopeMetric.scope : {};

  for (const pointRaw of metricData.dataPoints) {
    if (!isRecord(pointRaw)) {
      rejections.reject(`metric ${label} contains a malformed data point`);
      continue;
    }
    const point = structuredClone(pointRaw);
    // Redactors mutate in place. Isolate shared resource/scope identity for
    // every sibling so a non-idempotent policy cannot compound its output and
    // produce different SeriesIds within one OTLP request.
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
      rejections.reject(
        `metric ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface PrepareMetricDataPointsArgs {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: PiiRedactionLevel;
  redactionService: RedactionService;
  acceptedAt?: number;
}

/**
 * Canonicalizes an OTLP metric request into immutable data points. Nothing here
 * throws for bad input: every malformed container or point becomes a counted
 * rejection so the caller can answer with OTLP partial success.
 */
async function prepareMetricDataPoints(
  args: PrepareMetricDataPointsArgs,
): Promise<MetricPreparationResult> {
  const accepted: PreparedMetricPoint[] = [];
  const rejections = new RejectionLog();
  const acceptedAt = args.acceptedAt ?? Date.now();

  const request = exportMetricsRequestSchema.safeParse(args.request);
  const resourceMetrics = containerArray({
    value: request.success ? request.data.resourceMetrics : undefined,
    label: "resourceMetrics",
    rejections,
  });
  for (const resourceMetricRaw of resourceMetrics) {
    if (!isRecord(resourceMetricRaw)) continue;
    const resourceMetricParsed = unknownRecordSchema.safeParse(resourceMetricRaw);
    if (!resourceMetricParsed.success) continue;
    const resourceMetric = structuredClone(resourceMetricParsed.data);
    const scopeMetrics = containerArray({
      value: resourceMetric.scopeMetrics,
      label: "scopeMetrics",
      rejections,
    });
    for (const scopeMetricRaw of scopeMetrics) {
      if (!isRecord(scopeMetricRaw)) continue;
      const scopeMetricParsed = unknownRecordSchema.safeParse(scopeMetricRaw);
      if (!scopeMetricParsed.success) continue;
      const scopeMetric = structuredClone(scopeMetricParsed.data);
      const metrics = containerArray({
        value: scopeMetric.metrics,
        label: "metrics",
        rejections,
      });
      for (const metricRaw of metrics) {
        if (!isRecord(metricRaw)) continue;
        const metricParsed = unknownRecordSchema.safeParse(metricRaw);
        if (!metricParsed.success) continue;
        await prepareMetric({
          metric: structuredClone(metricParsed.data),
          resourceMetric,
          scopeMetric,
          args,
          acceptedAt,
          accepted,
          rejections,
        });
      }
    }
  }

  return {
    accepted,
    rejectedDataPoints: rejections.count,
    errors: rejections.messages,
  };
}

export class CanonicalMetricAdapter extends TelemetryMetricPreparationPort {
  private constructor() {
    super();
  }

  static create(): CanonicalMetricAdapter {
    return new CanonicalMetricAdapter();
  }

  prepare(input: TelemetryMetricPreparationInput): Promise<MetricPreparationResult> {
    return prepareMetricDataPoints(input);
  }
}

export { prepareMetricDataPoints };
