import { createHash } from "crypto";

import { EventUtils } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import type { SpanReceivedEvent } from "@langwatch/trace-contract";

import { OtlpTraceRequestService } from "./otlp-trace-request.service.ts";

/**
 * KSUID resource prefixes for the two identifiers this module mints. The
 * literals are the identity of every span record and trace-summary row
 * ever written, so they are pinned here rather than derived.
 */
const SPAN_KSUID_RESOURCE = "span";
const TRACE_SUMMARY_KSUID_RESOURCE = "tracesummary";

/**
 * Deterministic identities for a span record and its trace summary.
 * Derived, never random, so a redelivered span replaces the earlier row
 * instead of landing beside it. The KSUID's timestamp is the span's own.
 */
export class SpanRecordIdentityService {
  private constructor() {}

  static create(): SpanRecordIdentityService {
    return new SpanRecordIdentityService();
  }

  /**
   * Creates a deterministic KSUID from a hash key and timestamp.
   * Same inputs always produce the same ID, maintaining K-sortability.
   */
  private makeDeterministicKsuid({
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

    const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(hash.subarray(0, 8)));

    // Use the next 4 bytes for the sequence to further ensure uniqueness
    const sequence = ((hash[8]! << 24) | (hash[9]! << 16) | (hash[10]! << 8) | hash[11]!) >>> 0;

    const ksuid = new Ksuid(
      getEnvironment(),
      resource,
      Math.floor(timestampMs / 1000),
      instance,
      sequence,
    );

    return ksuid.toString();
  }

  generateDeterministicSpanRecordId(event: SpanReceivedEvent): string {
    const { traceId, spanId } = OtlpTraceRequestService.normalizeOtlpSpanIds(event.data.span);
    const startTimeUnixMs = OtlpTraceRequestService.convertUnixNanoToUnixMs(
      OtlpTraceRequestService.normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
    );

    return this.generateDeterministicSpanRecordIdFromData({
      tenantId: String(event.tenantId),
      traceId,
      spanId,
      startTimeUnixMs,
    });
  }

  generateDeterministicSpanRecordIdFromData({
    tenantId,
    traceId,
    spanId,
    startTimeUnixMs,
  }: {
    tenantId: string;
    traceId: string;
    spanId: string;
    startTimeUnixMs: number;
  }): string {
    EventUtils.validateTenantId({ tenantId }, "generateDeterministicSpanRecordIdFromData");

    return this.makeDeterministicKsuid({
      hashKey: `${tenantId}:${traceId}:${spanId}`,
      resource: SPAN_KSUID_RESOURCE,
      timestampMs: startTimeUnixMs,
    });
  }

  generateDeterministicTraceSummaryId(event: SpanReceivedEvent): string {
    const { traceId } = OtlpTraceRequestService.normalizeOtlpSpanIds(event.data.span);
    const startTimeUnixMs = OtlpTraceRequestService.convertUnixNanoToUnixMs(
      OtlpTraceRequestService.normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
    );

    return this.generateDeterministicTraceSummaryIdFromData(
      String(event.tenantId),
      traceId,
      startTimeUnixMs,
    );
  }

  generateDeterministicTraceSummaryIdFromData(
    tenantId: string,
    traceId: string,
    startTimeUnixMs: number,
  ): string {
    EventUtils.validateTenantId({ tenantId }, "generateDeterministicTraceSummaryIdFromData");

    return this.makeDeterministicKsuid({
      hashKey: `${tenantId}:${traceId}`,
      resource: TRACE_SUMMARY_KSUID_RESOURCE,
      timestampMs: startTimeUnixMs,
    });
  }
}
