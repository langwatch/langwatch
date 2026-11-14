import { createHash } from "crypto";

import { getEnvironment, Instance, Ksuid, type KsuidLayout } from "@langwatch/ksuid";

import type { SpanReceivedEvent } from "../features/ingest/trace-ingress.events.ts";
import {
  convertUnixNanoToUnixMs,
  normalizeOtlpUnixNano,
  checkTenantIsolation,
} from "./otlp-span-identity.ts";
import { OtlpTraceRequestService } from "./otlp-trace-request.ts";

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
    layout,
  }: {
    hashKey: string;
    resource: string;
    timestampMs: number;
    layout: KsuidLayout;
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

    const timestamp = Math.floor(timestampMs / 1000);
    const ksuid = new Ksuid({
      environment: getEnvironment(),
      resource,
      timestamp,
      instance,
      sequenceId: sequence,
      layout,
    });

    return ksuid.toString();
  }

  generateDeterministicSpanRecordId(event: SpanReceivedEvent): string {
    const { traceId, spanId } = OtlpTraceRequestService.normalizeOtlpSpanIds(event.data.span);
    const startTimeUnixMs = convertUnixNanoToUnixMs(
      normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
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
    checkTenantIsolation({ tenantId, operation: "generateDeterministicSpanRecordIdFromData" });

    // stored_spans dedups on (TenantId, TraceId, SpanId), never on this id, so spans mint v2
    return this.makeDeterministicKsuid({
      hashKey: `${tenantId}:${traceId}:${spanId}`,
      resource: SPAN_KSUID_RESOURCE,
      timestampMs: startTimeUnixMs,
      layout: "v2",
    });
  }

  /** `layout` is the stored summary row's own; a trace never stored takes "v2" (#9575). */
  generateDeterministicTraceSummaryId({
    event,
    layout,
  }: {
    event: SpanReceivedEvent;
    layout: KsuidLayout;
  }): string {
    const { traceId } = OtlpTraceRequestService.normalizeOtlpSpanIds(event.data.span);
    const startTimeUnixMs = convertUnixNanoToUnixMs(
      normalizeOtlpUnixNano(event.data.span.startTimeUnixNano),
    );

    return this.generateDeterministicTraceSummaryIdFromData({
      tenantId: String(event.tenantId),
      traceId,
      startTimeUnixMs,
      layout,
    });
  }

  /** `layout` is the stored summary row's own; a trace never stored takes "v2" (#9575). */
  generateDeterministicTraceSummaryIdFromData({
    tenantId,
    traceId,
    startTimeUnixMs,
    layout,
  }: {
    tenantId: string;
    traceId: string;
    startTimeUnixMs: number;
    layout: KsuidLayout;
  }): string {
    checkTenantIsolation({ tenantId, operation: "generateDeterministicTraceSummaryIdFromData" });

    return this.makeDeterministicKsuid({
      hashKey: `${tenantId}:${traceId}`,
      resource: TRACE_SUMMARY_KSUID_RESOURCE,
      timestampMs: startTimeUnixMs,
      layout,
    });
  }
}
