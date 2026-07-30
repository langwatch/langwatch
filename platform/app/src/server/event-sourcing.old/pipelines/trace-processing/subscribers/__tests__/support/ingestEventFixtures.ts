import { vi } from "vitest";

import type { EventSubscriberContext } from "~/server/event-sourcing.old/subscribers/eventSubscriber.types";

import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../../schemas/constants";
import type { TraceProcessingEvent } from "../../../schemas/events";

/**
 * Fixtures shared by the project-level ingest subscribers.
 *
 * They build **raw OTLP events**, not fold state, because that is the whole
 * point of the ADR-098 conversion: these subscribers see the event and nothing
 * else, and the facts they need are lifted from the wire payload by the same
 * normalization the trace-summary fold runs. A fixture that handed them a
 * pre-built attribute map would skip exactly the step that can break.
 */
export const TENANT_ID = "project-123";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SPAN_ID = "a1b2c3d4e5f6a7b8";

/** A raw `span_received` event exactly as the trace pipeline stores it. */
export function spanEvent({
  tenantId = TENANT_ID,
  traceId = TRACE_ID,
  spanAttributes = {},
  resourceAttributes = {},
}: {
  tenantId?: string;
  traceId?: string;
  spanAttributes?: Record<string, string>;
  resourceAttributes?: Record<string, string>;
} = {}): TraceProcessingEvent {
  return {
    id: `event-${traceId}`,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {
        traceId,
        spanId: SPAN_ID,
        name: "chat",
        kind: 1,
        startTimeUnixNano: String(1_000 * 1_000_000),
        endTimeUnixNano: String(2_000 * 1_000_000),
        attributes: toKeyValues(spanAttributes),
        status: { code: 0 },
        events: [],
        links: [],
      },
      resource: { attributes: toKeyValues(resourceAttributes) },
      instrumentationScope: { name: "langwatch" },
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: SPAN_ID, traceId },
  } as unknown as TraceProcessingEvent;
}

/**
 * The deferred-origin event `originGate` emits for a trace whose spans carried
 * no origin of their own.
 */
export function originResolvedEvent({
  tenantId = TENANT_ID,
  traceId = TRACE_ID,
  origin,
}: {
  tenantId?: string;
  traceId?: string;
  origin: string;
}): TraceProcessingEvent {
  return {
    id: `event-origin-${traceId}`,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: ORIGIN_RESOLVED_EVENT_TYPE,
    version: "2026-03-13",
    data: { origin, reason: "deferred" },
    metadata: {},
  } as unknown as TraceProcessingEvent;
}

export function subscriberContext(
  tenantId = TENANT_ID,
  aggregateId = TRACE_ID,
): EventSubscriberContext {
  return { tenantId, aggregateId };
}

export function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    repo: {} as any,
  };
}

function toKeyValues(
  attributes: Record<string, string>,
): { key: string; value: { stringValue: string } }[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}
