import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createHash } from "crypto";
import { KSUID_RESOURCES } from "~/utils/constants";
import { EventUtils } from "../../../";
import type {
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  SpanReceivedEvent,
} from "../schemas/events";
import { TraceRequestUtils } from "./traceRequest.utils";

/**
 * Creates a deterministic KSUID from a hash key and timestamp.
 * Same inputs always produce the same ID, maintaining K-sortability.
 */
function makeDeterministicKsuid({
  hashKey,
  resource,
  timestampMs,
}: {
  hashKey: string;
  resource: string;
  timestampMs: number;
}): string {
  const hash = createHash("sha256").update(hashKey).digest();
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(hash.subarray(0, 8)),
  );
  const ksuid = new Ksuid(
    getEnvironment(),
    resource,
    Math.floor(timestampMs / 1000),
    instance,
    0,
  );
  return ksuid.toString();
}

function generateDeterministicSpanRecordId(event: SpanReceivedEvent): string {
  const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(event.data.span);
  const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
    TraceRequestUtils.normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
  );
  return generateDeterministicSpanRecordIdFromData(String(event.tenantId), traceId, spanId, startTimeUnixMs);
}

function generateDeterministicSpanRecordIdFromData(
  tenantId: string,
  traceId: string,
  spanId: string,
  startTimeUnixMs: number,
): string {
  EventUtils.validateTenantId({ tenantId }, "generateDeterministicSpanRecordIdFromData");
  return makeDeterministicKsuid({
    hashKey: `${tenantId}:${traceId}:${spanId}`,
    resource: KSUID_RESOURCES.SPAN,
    timestampMs: startTimeUnixMs,
  });
}

function generateDeterministicTraceSummaryId(event: SpanReceivedEvent): string {
  const { traceId } = TraceRequestUtils.normalizeOtlpSpanIds(event.data.span);
  const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
    TraceRequestUtils.normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
  );
  return generateDeterministicTraceSummaryIdFromData(String(event.tenantId), traceId, startTimeUnixMs);
}

function generateDeterministicTraceSummaryIdFromData(
  tenantId: string,
  traceId: string,
  startTimeUnixMs: number,
): string {
  EventUtils.validateTenantId({ tenantId }, "generateDeterministicTraceSummaryIdFromData");
  return makeDeterministicKsuid({
    hashKey: `${tenantId}:${traceId}`,
    resource: KSUID_RESOURCES.TRACE_SUMMARY,
    timestampMs: startTimeUnixMs,
  });
}

function generateDeterministicLogRecordId(event: LogRecordReceivedEvent): string {
  EventUtils.validateTenantId({ tenantId: event.tenantId }, "generateDeterministicLogRecordId");
  const bodyHash = createHash("sha256").update(event.data.body).digest("hex").slice(0, 16);
  return makeDeterministicKsuid({
    hashKey: `${event.tenantId}:${event.data.traceId}:${event.data.spanId}:${event.data.severityNumber}:${event.data.scopeName}:${bodyHash}`,
    resource: KSUID_RESOURCES.LOG_RECORD,
    timestampMs: event.data.timeUnixMs,
  });
}

function generateDeterministicMetricRecordId(event: MetricRecordReceivedEvent): string {
  EventUtils.validateTenantId({ tenantId: event.tenantId }, "generateDeterministicMetricRecordId");
  return makeDeterministicKsuid({
    hashKey: `${event.tenantId}:${event.data.traceId}:${event.data.spanId}:${event.data.metricName}:${event.data.metricType}`,
    resource: KSUID_RESOURCES.METRIC_RECORD,
    timestampMs: event.data.timeUnixMs,
  });
}

export const IdUtils = {
  generateDeterministicSpanRecordId,
  generateDeterministicSpanRecordIdFromData,
  generateDeterministicTraceSummaryId,
  generateDeterministicTraceSummaryIdFromData,
  generateDeterministicLogRecordId,
  generateDeterministicMetricRecordId,
} as const;
