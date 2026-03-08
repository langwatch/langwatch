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
  // Use a hash of both the key and the full timestamp (including ms) to ensure
  // the Instance and sequence parts of the KSUID are unique even within the same second.
  const hash = createHash("sha256")
    .update(hashKey)
    .update(":")
    .update(String(timestampMs))
    .digest();

  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(hash.subarray(0, 8)),
  );

  // Use the next 4 bytes for the sequence to further ensure uniqueness
  const sequence =
    ((hash[8]! << 24) | (hash[9]! << 16) | (hash[10]! << 8) | hash[11]!) >>> 0;

  const ksuid = new Ksuid(
    getEnvironment(),
    resource,
    Math.floor(timestampMs / 1000),
    instance,
    sequence,
  );
  return ksuid.toString();
}

function generateDeterministicSpanRecordId(event: SpanReceivedEvent): string {
  const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
    event.data.span,
  );
  const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
    TraceRequestUtils.normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
  );
  return generateDeterministicSpanRecordIdFromData(
    String(event.tenantId),
    traceId,
    spanId,
    startTimeUnixMs,
  );
}

function generateDeterministicSpanRecordIdFromData(
  tenantId: string,
  traceId: string,
  spanId: string,
  startTimeUnixMs: number,
): string {
  EventUtils.validateTenantId(
    { tenantId },
    "generateDeterministicSpanRecordIdFromData",
  );
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
  return generateDeterministicTraceSummaryIdFromData(
    String(event.tenantId),
    traceId,
    startTimeUnixMs,
  );
}

function generateDeterministicTraceSummaryIdFromData(
  tenantId: string,
  traceId: string,
  startTimeUnixMs: number,
): string {
  EventUtils.validateTenantId(
    { tenantId },
    "generateDeterministicTraceSummaryIdFromData",
  );
  return makeDeterministicKsuid({
    hashKey: `${tenantId}:${traceId}`,
    resource: KSUID_RESOURCES.TRACE_SUMMARY,
    timestampMs: startTimeUnixMs,
  });
}

function generateDeterministicLogRecordId(
  event: LogRecordReceivedEvent,
): string {
  EventUtils.validateTenantId(
    { tenantId: event.tenantId },
    "generateDeterministicLogRecordId",
  );

  const attributesHash = createHash("sha256")
    .update(JSON.stringify(Object.entries(event.data.attributes).sort()))
    .update(
      JSON.stringify(Object.entries(event.data.resourceAttributes).sort()),
    )
    .digest("hex")
    .slice(0, 8);

  const bodyHash = createHash("sha256")
    .update(event.data.body)
    .digest("hex")
    .slice(0, 16);

  return makeDeterministicKsuid({
    hashKey: `${event.tenantId}:${event.data.traceId}:${event.data.spanId}:${event.data.severityNumber}:${event.data.scopeName}:${event.data.scopeVersion}:${attributesHash}:${bodyHash}`,
    resource: KSUID_RESOURCES.LOG_RECORD,
    timestampMs: event.data.timeUnixMs,
  });
}

function generateDeterministicMetricRecordId(
  event: MetricRecordReceivedEvent,
): string {
  EventUtils.validateTenantId(
    { tenantId: event.tenantId },
    "generateDeterministicMetricRecordId",
  );

  const attributesHash = createHash("sha256")
    .update(JSON.stringify(Object.entries(event.data.attributes).sort()))
    .update(
      JSON.stringify(Object.entries(event.data.resourceAttributes).sort()),
    )
    .digest("hex")
    .slice(0, 8);

  return makeDeterministicKsuid({
    hashKey: `${event.tenantId}:${event.data.traceId}:${event.data.spanId}:${event.data.metricName}:${event.data.metricType}:${attributesHash}`,
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
