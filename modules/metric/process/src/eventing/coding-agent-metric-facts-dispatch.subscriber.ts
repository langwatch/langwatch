import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  type MetricProcessingEvent,
} from "@langwatch/metric-contract";

/** Main's metric-facts dispatch (ADR-056): forwards each received point to coding-agent. */
export function createCodingAgentMetricFactsDispatchSubscriber(deps: {
  codingAgents: Pick<CodingAgentApi, "contributeReceivedMetricPoint">;
}): EventSubscriberDefinition<MetricProcessingEvent> {
  return {
    name: "codingAgentMetricFactsDispatch",
    eventTypes: [METRIC_DATA_POINT_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) => `coding-agent-metric-facts:${event.tenantId}:${event.data.pointId}`,
        ttlMs: 60_000,
      },
    },
    handle: (event) => deps.codingAgents.contributeReceivedMetricPoint(event.data),
  };
}
