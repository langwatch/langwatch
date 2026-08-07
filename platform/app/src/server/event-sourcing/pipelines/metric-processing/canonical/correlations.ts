import { decodeBase64OpenTelemetryId } from "~/server/tracer/utils";
import type {
  MetricKind,
  MetricTraceCorrelation,
} from "../schemas/metricDataPoint";
import { finiteNumber, timestampDecimal, timestampMs } from "./numbers";
import { isRecord } from "./serialization";

function validTraceId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value);
}

function validSpanId(value: string): boolean {
  return /^[a-f0-9]{16}$/i.test(value) && !/^0+$/.test(value);
}

function correlationFromExemplar({
  raw,
  tenantId,
  pointId,
  seriesId,
  metricName,
  metricUnit,
  metricKind,
  occurredAt,
}: {
  raw: unknown;
  tenantId: string;
  pointId: string;
  seriesId: string;
  metricName: string;
  metricUnit: string;
  metricKind: MetricKind;
  occurredAt: number;
}): { key: string; correlation: MetricTraceCorrelation } | undefined {
  if (!isRecord(raw)) return undefined;
  const traceId = (
    decodeBase64OpenTelemetryId(raw.traceId) ?? ""
  ).toLowerCase();
  const spanId = (decodeBase64OpenTelemetryId(raw.spanId) ?? "").toLowerCase();
  if (!validTraceId(traceId) || !validSpanId(spanId)) return undefined;
  const exemplarTime = timestampDecimal(raw.timeUnixNano);
  const exemplarValue = finiteNumber(raw.asDouble ?? raw.asInt);
  const resolvedOccurredAt = exemplarTime
    ? timestampMs(exemplarTime)
    : occurredAt;
  return {
    key: `${traceId}:${spanId}`,
    correlation: {
      tenantId,
      traceId,
      spanId,
      pointId,
      seriesId,
      metricName,
      metricUnit,
      metricKind,
      exemplarValue,
      exemplarTimeUnixMs: resolvedOccurredAt,
      occurredAt: resolvedOccurredAt,
    },
  };
}

/**
 * Exemplars that name a real trace and span become trace-scoped correlations.
 * Everything else stays in the canonical point only: a trace fold must never
 * see an exemplar it cannot attach to a span.
 */
export function correlations(args: {
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
    const found = correlationFromExemplar({
      raw,
      tenantId: args.tenantId,
      pointId: args.pointId,
      seriesId: args.seriesId,
      metricName: args.metricName,
      metricUnit: args.metricUnit,
      metricKind: args.metricKind,
      occurredAt: args.occurredAt,
    });
    if (!found || unique.has(found.key)) continue;
    unique.set(found.key, found.correlation);
  }
  return [...unique.values()];
}
