import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  type LogProcessingEvent,
} from "@langwatch/log-contract";

/** Main's log-facts dispatch (ADR-056): forwards each received record to coding-agent. */
export function createCodingAgentLogFactsDispatchSubscriber(deps: {
  codingAgents: Pick<CodingAgentApi, "contributeReceivedLogRecord">;
}): EventSubscriberDefinition<LogProcessingEvent> {
  return {
    name: "codingAgentLogFactsDispatch",
    eventTypes: [CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) => `coding-agent-log-facts:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: 60_000,
      },
    },
    handle: (event) => deps.codingAgents.contributeReceivedLogRecord(event.data),
  };
}
