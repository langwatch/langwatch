import {
  GovernanceEventDeliveryProcess,
  GOVERNANCE_EVENTS_PROCESS_NAME,
} from "@langwatch/enterprise-governance-server";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
} from "@langwatch/eventing";
import {
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "./commands/governanceCommands";
import {
  GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GOVERNANCE_EVENTS_EVENT_TYPES,
  GOVERNANCE_EVENTS_PIPELINE_NAME,
} from "./schemas/constants";
import type { GovernanceEventsProcessingEvent } from "./schemas/events";

export interface GovernanceEventsPipelineDeps {
  /** Same deps object as the spend delivery process; absent = no delivery
   *  consumer (events still append for a later replay-through). */
  webhookDelivery?: GovernanceEventDeliveryProcess;
}

/**
 * Governance signal pipeline: virtual-key lifecycle changes and budget
 * threshold/breach crossings, appended by the control plane's own
 * services (never the request hot path) and delivered over the webhook
 * platform by its process manager. Aggregate = the governed subject, so
 * each key and each budget is an ordered stream.
 */
export function createGovernanceEventsPipeline(
  deps: GovernanceEventsPipelineDeps,
) {
  let pipeline = definePipeline<GovernanceEventsProcessingEvent>({
    name: GOVERNANCE_EVENTS_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: GOVERNANCE_EVENTS_AGGREGATE_TYPE,
      events: defineEvents(GOVERNANCE_EVENTS_EVENT_TYPES),
    }),
  })
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand);
  if (deps.webhookDelivery) {
    pipeline = pipeline.withProcessManager(
      GOVERNANCE_EVENTS_PROCESS_NAME,
      deps.webhookDelivery.processManager(),
    );
  }
  return pipeline.build();
}
