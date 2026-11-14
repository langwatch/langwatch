import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  logFactsContributedEventSchema,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  spanFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TestModelProviderService } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import { ClaudeAnswersTraceCanonicalisation } from "../../__tests__/fixtures/trace-canonicalisation.fixture.ts";
import { OtelCodingAgentCostMetricsService } from "../../services/coding-agent-cost-metrics.service.ts";
import { createCodingAgentCostDriftSubscriber } from "../coding-agent-cost-drift.subscriber.ts";

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
    const metrics = OtelCodingAgentCostMetricsService.create();
    const subscriber = createCodingAgentCostDriftSubscriber({
      metrics,
      modelProviders: new TestModelProviderService(),
      traceCanonicalisation: ClaudeAnswersTraceCanonicalisation.create(),
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

  describe("when a pi model-call span reports a cost the catalogue disagrees with", () => {
    /** @scenario "The two figures disagreeing is readable, not reconciled away" */
    it("records the computed and the reported figure each on its own counter", async () => {
      const subscriber = createCodingAgentCostDriftSubscriber({
        metrics: OtelCodingAgentCostMetricsService.create(),
        modelProviders: new TestModelProviderService(() => 0.002),
        traceCanonicalisation: ClaudeAnswersTraceCanonicalisation.create(),
      });
      const event = spanFactsContributedEventSchema.parse({
        id: "pi-call-1",
        aggregateId: "pi-session-1",
        aggregateType: "coding_agent_session",
        tenantId: "project-1",
        createdAt: 1_000,
        occurredAt: 1_000,
        type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data: {
          tenantId: "project-1",
          sessionId: "pi-session-1",
          sessionKeySource: "provider",
          agent: "pi",
          occurredAt: 1_000,
          traceId: "c0ffee00c0ffee00c0ffee00c0ffee00",
          spanId: "span-1",
          name: "pi.ai.request",
          startTimeUnixMs: 1_000,
          endTimeUnixMs: 2_500,
          statusCode: 0,
          scopeName: null,
          facts: {
            "pi.session.id": "pi-session-1",
            "gen_ai.request.model": "claude-opus-4-7",
            "gen_ai.usage.input_tokens": 120,
            "gen_ai.usage.output_tokens": 30,
            "pi.ai.usage.cost": 0.0875,
          },
        },
      });

      await subscriber.handle(event, { tenantId: "project-1", aggregateId: "pi-session-1" });

      const labels = { agent: "pi", model: "claude-opus-4-7" };
      expect(metricsHarness.valueOf("coding_agent_cost_computed_usd_total", labels)).toBe(0.002);
      expect(metricsHarness.valueOf("coding_agent_cost_reported_usd_total", labels)).toBe(0.0875);
    });
  });
});
