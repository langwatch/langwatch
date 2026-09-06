import type { NormalizedSpan } from "@langwatch/trace-contract";
import { mapChRowToNormalized, serializeAttributes } from "../stored-span-row.mapper";

/**
 * A normalized span put through the real ClickHouse row round trip.
 *
 * The claim-check read path rebuilds a span from its stored row rather than
 * from the value it wrote, so a test that spreads the original masks exactly
 * the mapping regressions this exists to catch.
 */
export function storedSpanReadBack(span: NormalizedSpan): NormalizedSpan {
  return mapChRowToNormalized({
    SpanId: span.spanId,
    TraceId: span.traceId,
    TenantId: span.tenantId,
    ParentSpanId: span.parentSpanId ?? null,
    ParentTraceId: span.parentTraceId ?? null,
    ParentIsRemote: span.parentIsRemote ?? null,
    Sampled: span.sampled,
    StartTimeMs: span.startTimeUnixMs,
    EndTimeMs: span.endTimeUnixMs,
    DurationMs: span.durationMs,
    SpanName: span.name,
    SpanKind: span.kind,
    ResourceAttributes: serializeAttributes(span.resourceAttributes),
    SpanAttributes: serializeAttributes(span.spanAttributes),
    StatusCode: span.statusCode,
    StatusMessage: span.statusMessage ?? null,
    ScopeName: span.instrumentationScope?.name ?? null,
    ScopeVersion: span.instrumentationScope?.version ?? null,
    Cost: span.cost ?? null,
    NonBilledCost: span.nonBilledCost ?? null,
    Events_Timestamp: span.events.map((spanEvent) => spanEvent.timeUnixMs),
    Events_Name: span.events.map((spanEvent) => spanEvent.name),
    Events_Attributes: span.events.map((spanEvent) => serializeAttributes(spanEvent.attributes)),
    Links_TraceId: span.links.map((link) => link.traceId),
    Links_SpanId: span.links.map((link) => link.spanId),
    Links_Attributes: span.links.map((link) => serializeAttributes(link.attributes)),
  }) as NormalizedSpan;
}
