import { createTenantId } from "@langwatch/eventing";
import {
  GovernanceSubscriberDiagnosticsPort,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "../../src/ports/governance-subscriber.port";

export class SilentSubscriberDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  warn(): void {}
  capture(): void {}
}

export const governanceTraceEvent: GovernanceTraceEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: createTenantId("project-1"),
  createdAt: 1_000,
  occurredAt: 1_000,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {},
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
