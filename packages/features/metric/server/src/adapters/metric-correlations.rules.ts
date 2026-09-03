import { decodeBase64OpenTelemetryId } from "@langwatch/otlp";
import type { MetricKind, MetricTraceCorrelation } from "@langwatch/metric-contract";
import { MetricNumbers } from "./metric-numbers.rules";
import { isRecord } from "./metric-serialization.rules";

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
    const traceId = (decodeBase64OpenTelemetryId(raw.traceId) ?? "").toLowerCase();
    const spanId = (decodeBase64OpenTelemetryId(raw.spanId) ?? "").toLowerCase();
    if (!validTraceId(traceId) || !validSpanId(spanId)) continue;
    const exemplarTime = MetricNumbers.timestampDecimal(raw.timeUnixNano);
    const exemplarValue = MetricNumbers.finiteNumber(raw.asDouble ?? raw.asInt);
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
      exemplarTimeUnixMs: exemplarTime ? MetricNumbers.timestampMs(exemplarTime) : args.occurredAt,
      occurredAt: exemplarTime ? MetricNumbers.timestampMs(exemplarTime) : args.occurredAt,
    });
  }
  return [...unique.values()];
}

export { correlations };
