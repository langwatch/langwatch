import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  logFactsContributedEventSchema,
  spanFactsContributedEventSchema,
  type CodingAgentProcessingEvent,
} from "@langwatch/coding-agent-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { CodingAgentCostEstimatorPort } from "../ports/coding-agent-cost-estimator.port";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { CodingAgentCostMetricsPort } from "../ports/coding-agent-cost-metrics.port";
import { CodingAgentSessionStateProjection } from "../projections/coding-agent-session-state.projection";
import { CodingAgentSessionSpanProjection } from "../projections/coding-agent-session-span.projection";
import { CodingAgentSessionLogProjection } from "../projections/coding-agent-session-log.projection";

function labels(agent: string, facts: Record<string, unknown>) {
  const model = facts.model ?? facts["gen_ai.request.model"] ?? facts["gen_ai.response.model"];

  return {
    agent,
    model: typeof model === "string" && model.length > 0 ? model : "unknown",
  };
}

export function createCodingAgentCostDriftSubscriber(input: {
  metrics: CodingAgentCostMetricsPort;
  modelProviders: CodingAgentCostEstimatorPort;
  traceCanonicalisation: TraceCanonicalisationService;
}): EventSubscriberDefinition<CodingAgentProcessingEvent> {
  const stateProjection = CodingAgentSessionStateProjection.create();
  const spanProjection = CodingAgentSessionSpanProjection.create({
    stateProjection,
    traceCanonicalisation: input.traceCanonicalisation,
    modelProviders: input.modelProviders,
  });
  const logProjection = CodingAgentSessionLogProjection.create({ stateProjection });

  return {
    name: "codingAgentCostDrift",
    eventTypes: [SPAN_FACTS_CONTRIBUTED_EVENT_TYPE, LOG_FACTS_CONTRIBUTED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) => `coding-agent-cost-drift:${event.id}`,
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      if (event.type === SPAN_FACTS_CONTRIBUTED_EVENT_TYPE) {
        const parsed = spanFactsContributedEventSchema.parse(event);
        const data = parsed.data;
        const next = spanProjection.applySpanToCodingAgentSession({
          state: stateProjection.createInitCodingAgentSession(),
          span: {
            name: data.name,
            startTimeUnixMs: data.startTimeUnixMs,
            endTimeUnixMs: data.endTimeUnixMs,
            statusCode: data.statusCode,
            attrs: data.facts,
          },
          agent: data.agent,
        });

        input.metrics.recordComputed({
          eventId: parsed.id,
          ...labels(data.agent, data.facts),
          valueUsd: next.costUsd,
        });
        return;
      }

      const parsed = logFactsContributedEventSchema.parse(event);
      const data = parsed.data;
      const next = logProjection.applyLogToCodingAgentSession({
        state: stateProjection.createInitCodingAgentSession(),
        attributes: data.facts,
        agent: data.agent,
        occurredAtMs: data.timeUnixMs,
      });

      input.metrics.recordReported({
        eventId: parsed.id,
        ...labels(data.agent, data.facts),
        valueUsd: next.agentReportedCostUsd,
      });
    },
  };
}
