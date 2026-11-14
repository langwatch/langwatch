/** The analytics fold lets a log's `service.name` name only a trace nothing has named. */
import { createTenantId } from "@langwatch/eventing";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
  type LogContributedEvent,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { createTestRuntime } from "./trace-summary-test.fixtures.ts";

const TRACE_ID = "aaaa0000000000000000000000000009";

const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

function contribution(service: string): LogContributedEvent {
  return {
    id: "evt-contribution",
    type: LOG_CONTRIBUTED_EVENT_TYPE,
    version: LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: TRACE_ID,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    data: {
      recordId: "e".repeat(64),
      traceId: TRACE_ID,
      spanId: "1122334455667788",
      timeUnixMs: 1_700_000_000_000,
      severityNumber: 9,
      severityText: "INFO",
      providerKind: "grok",
      scopeName: "ai.xai.grok_code",
      correlationSource: "wire",
      input: null,
      output: null,
      liftedAttributes: { "service.name": service },
      nonBillable: false,
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

describe("TraceAnalyticsFoldProjection, given a log that names its service", () => {
  it("names a trace nothing has named yet", () => {
    const after = projection.handleTraceLogContributed(contribution("grok-cli"), projection.init());
    expect(after.attributes["service.name"]).toBe("grok-cli");
  });

  it("never replaces a service already named", () => {
    const state = projection.init();
    const named = { ...state, attributes: { ...state.attributes, "service.name": "app" } };
    const after = projection.handleTraceLogContributed(contribution("codex"), named);
    expect(after.attributes["service.name"]).toBe("app");
  });
});
