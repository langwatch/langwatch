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
