import type { OtlpInstrumentationScope, OtlpResource, OtlpSpan } from "../trace.otlp.ts";
import type { NormalizedEvent, NormalizedSpan } from "../trace.spans.ts";
import {
  convertUnixNanoToUnixMs,
  normalizeOtlpId,
  normalizeOtlpUnixNano,
} from "./otlp-span-identity.ts";
import { OtlpTraceRequestService } from "./otlp-trace-request.ts";
import { SpanRecordIdentityService } from "./span-record-identity.ts";

const spanRecordIdentityService = SpanRecordIdentityService.create();

function decodeEvents(otlpSpan: OtlpSpan): NormalizedEvent[] {
  return otlpSpan.events
    .filter((event) => Boolean(event))
    .map((event) => ({
      name: event.name,
      timeUnixMs: convertUnixNanoToUnixMs(normalizeOtlpUnixNano(event.timeUnixNano)),
      attributes: OtlpTraceRequestService.normalizeOtlpAttributes(event.attributes),
    }));
}

function decodeLinks(otlpSpan: OtlpSpan): NormalizedSpan["links"] {
  return otlpSpan.links
    .filter((link) => Boolean(link))
    .map((link) => ({
      traceId: normalizeOtlpId(link.traceId),
      spanId: normalizeOtlpId(link.spanId),
      attributes: OtlpTraceRequestService.normalizeOtlpAttributes(link.attributes),
    }));
}

/**
 * One OTLP span decoded into trace's normalized shape, attributes as received:
 * canonicalisation is trace's (`TraceApi.canonicalizeSpanAttributes`).
 */
export function decodeOtlpSpan({
  tenantId,
  otlpSpan,
  otlpResource,
  otlpInstrumentationScope,
}: {
  tenantId: string;
  otlpSpan: OtlpSpan;
  otlpResource: OtlpResource | null;
  otlpInstrumentationScope: OtlpInstrumentationScope | null;
}): NormalizedSpan {
  const { traceId, spanId } = OtlpTraceRequestService.normalizeOtlpSpanIds(otlpSpan);
  const startTimeUnixNano = normalizeOtlpUnixNano(otlpSpan.startTimeUnixNano);
  const endTimeUnixNano = normalizeOtlpUnixNano(otlpSpan.endTimeUnixNano);
  const startTimeUnixMs = convertUnixNanoToUnixMs(startTimeUnixNano);
  const endTimeUnixMs = convertUnixNanoToUnixMs(endTimeUnixNano);
  const durationMs = Math.max(0, endTimeUnixMs - startTimeUnixMs);
  const parentAndTraceContext = OtlpTraceRequestService.normalizeOtlpParentAndTraceContext(
    otlpSpan.parentSpanId,
    otlpSpan.traceState,
    otlpSpan.flags,
  );

  return {
    id: spanRecordIdentityService.generateDeterministicSpanRecordIdFromData({
      tenantId,
      traceId,
      spanId,
      startTimeUnixMs,
    }),
    tenantId,
    traceId,
    spanId,
    parentSpanId: parentAndTraceContext.spanId,
    parentTraceId: parentAndTraceContext.traceId,
    parentIsRemote: parentAndTraceContext.isRemote,
    // sampled: default to true, as we are on the collector end
    sampled: parentAndTraceContext.isSampled ?? true,

    startTimeUnixMs,
    endTimeUnixMs,
    durationMs,

    name: otlpSpan.name,
    kind: OtlpTraceRequestService.normalizeOtlpSpanKind(otlpSpan.kind),

    instrumentationScope: {
      name: otlpInstrumentationScope?.name ?? "unknown",
      version: otlpInstrumentationScope?.version ?? null,
    },

    statusCode: OtlpTraceRequestService.normalizeOtlpStatusCode(otlpSpan.status.code),
    statusMessage: otlpSpan.status.message ?? null,

    resourceAttributes: OtlpTraceRequestService.normalizeOtlpAttributes(
      otlpResource?.attributes ?? [],
    ),
    spanAttributes: OtlpTraceRequestService.normalizeOtlpAttributes(otlpSpan.attributes),

    events: decodeEvents(otlpSpan),
    links: decodeLinks(otlpSpan),

    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,

    // Cost is derived in the span-storage projection from tokens and pricing; null keeps
    // the span schema-valid until the projection overwrites both.
    cost: null,
    nonBilledCost: null,
  };
}
