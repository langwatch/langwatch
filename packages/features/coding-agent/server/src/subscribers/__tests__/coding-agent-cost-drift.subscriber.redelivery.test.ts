import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  logFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { TraceCanonicalisationService } from "@langwatch/trace-server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OtelCodingAgentCostMetricsAdapter } from "../../adapters/otel.coding-agent-cost-metrics.adapter";
import { createCodingAgentCostDriftSubscriber } from "../coding-agent-cost-drift.subscriber";
import { TestModelProviderService } from "../../adapters/__tests__/fixtures/coding-agent-processing.fixture";

describe("codingAgentCostDrift subscriber redelivery", () => {
  let metricsHarness: ReturnType<typeof createRecordingMeterProvider>;

  beforeEach(() => {
    metricsHarness = createRecordingMeterProvider();
    metricsHarness.install();
  });

  afterEach(() => {
    metricsHarness.uninstall();
  });

  it("increments the real reported-cost counter once for same-process redelivery", async () => {
    const metrics = OtelCodingAgentCostMetricsAdapter.create();
    const subscriber = createCodingAgentCostDriftSubscriber({
      metrics,
      modelProviders: new TestModelProviderService(),
      traceCanonicalisation: TraceCanonicalisationService.create(),
    });
    const event = logFactsContributedEventSchema.parse({
      id: "cost-event-1",
      aggregateId: "session-1",
      aggregateType: "coding_agent_session",
      tenantId: "project-1",
      createdAt: 1_000,
      occurredAt: 1_000,
      type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
      version: LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
      data: {
        tenantId: "project-1",
        sessionId: "session-1",
        sessionKeySource: "provider",
        agent: "claude_cowork",
        occurredAt: 1_000,
        recordId: "record-1",
        traceId: null,
        spanId: null,
        timeUnixMs: 1_000,
        severityNumber: 9,
        providerKind: "claude_cowork",
        scopeName: "com.anthropic.claude_code.events",
        facts: { "event.name": "api_request", cost_usd: 1, model: "claude" },
      },
    });
    const context = { tenantId: "project-1", aggregateId: "session-1" };

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect(
      metricsHarness.valueOf("coding_agent_cost_reported_usd_total", {
        agent: "claude_cowork",
        model: "claude",
      }),
    ).toBe(1);
  });
});
