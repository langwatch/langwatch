import { createTenantId } from "@langwatch/eventing";
import type {
  GovernanceSubscriberDiagnosticsSink,
  GovernanceTraceContext,
  GovernanceTraceEvent,
} from "../../app/governance.members.ts";

export class SilentSubscriberDiagnostics implements GovernanceSubscriberDiagnosticsSink {
  warn(): void {}
  capture(): void {}
}

/**
 * Real span_received event, not an empty {}. Though no subscriber reads data,
 * GovernanceTraceEvent is an 11-member union; empty data doesn't match any.
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
