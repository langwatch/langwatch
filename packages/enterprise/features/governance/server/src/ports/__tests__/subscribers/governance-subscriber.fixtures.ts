import { createTenantId } from "@langwatch/eventing";
import {
  GovernanceSubscriberDiagnosticsPort,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "../../governance-subscriber.port";

export class SilentSubscriberDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  warn(): void {}
  capture(): void {}
}

/**
 * A real `span_received` event, not a `{}` standing in for one.
 *
 * None of the three governance subscribers reads `data` — the KPI one ignores
 * the event entirely (`when(_event, context)`) and the alert one takes only
 * `event.occurredAt`. But `GovernanceTraceEvent` is the eleven-member trace
 * processing union, and an empty `data` is not any of them, so the fixture was
 * describing a shape the pipeline never delivers. It is spelled out now: the
 * span the event carries, and the three sibling fields the ingress contract
 * requires beside it.
 */
export const governanceTraceEvent: GovernanceTraceEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: createTenantId("project-1"),
  createdAt: 1_000,
  occurredAt: 1_000,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {
    span: {
      traceId: "trace-1",
      spanId: "span-1",
      name: "POST /v1/chat/completions",
      kind: "SPAN_KIND_CLIENT",
      startTimeUnixNano: "1000000",
      endTimeUnixNano: "2000000",
      attributes: [],
      events: [],
      links: [],
      status: { code: null, message: null },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "STRICT",
  },
  metadata: { spanId: "span-1", traceId: "trace-1" },
};

export const governanceTraceContext: GovernanceTraceContext = {
  tenantId: "project-1",
  aggregateId: "trace-1",
  state: {
    traceId: "trace-1",
    occurredAt: 1_700_000_000_000,
    totalCost: 0.0042,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 42,
    models: ["model-1"],
    attributes: {
      "langwatch.origin.kind": "ingestion_source",
      "langwatch.ingestion_source.id": "source-1",
      "langwatch.ingestion_source.source_type": "otel_generic",
    },
  },
};
