import {
  decodeBase64OpenTelemetryId,
  isValidSpanId,
  isValidTraceId,
} from "~/server/tracer/utils";
import type { MetricKind, MetricTraceCorrelation } from "../schema";
import { finiteNumber, timestampDecimal, timestampMs } from "./numbers";
import { isRecord } from "./serialization";

/**
 * Exemplars that name a real trace and span become trace-scoped correlation
 * records. Everything else stays inside the canonical point only — a trace
 * fold must never see an exemplar it cannot attach to a span, and a point
 * whose exemplars fail to correlate is still an accepted point (ADR / spec:
 * correlation is best-effort, never a rejection reason).
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
    if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) continue;
    const exemplarTime = timestampDecimal(raw.timeUnixNano);
    // asDouble/asInt: 0 is a real exemplar value, so this reads through
    // finiteNumber (never a truthiness check) exactly like the point's own
    // scalar value does.
    const exemplarValue = finiteNumber(raw.asDouble ?? raw.asInt);
    const key = `${traceId}:${spanId}`;
    if (unique.has(key)) continue;
    const at = exemplarTime ? timestampMs(exemplarTime) : args.occurredAt;
    unique.set(key, {
      tenantId: args.tenantId,
      traceId,
      spanId,
      pointId: args.pointId,
      seriesId: args.seriesId,
      metricName: args.metricName,
      metricUnit: args.metricUnit,
      metricKind: args.metricKind,
      exemplarValue,
      exemplarTimeUnixMs: at,
      occurredAt: at,
    });
  }
  return [...unique.values()];
}
