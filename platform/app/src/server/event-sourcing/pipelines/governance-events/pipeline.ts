import {
  GOVERNANCE_EVENTS_PROCESS_NAME,
  governanceEventsDeliveryPM,
} from "@ee/governance/process-manager/governanceEventsDelivery.process";
import type { WebhookDeliveryProcessDeps } from "@ee/webhooks/process-manager/webhookDelivery.process";
import { definePipeline } from "../..";
import {
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "./commands/governanceCommands";
import {
  GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GOVERNANCE_EVENTS_PIPELINE_NAME,
} from "./schemas/constants";
import type { GovernanceEventsProcessingEvent } from "./schemas/events";

export interface GovernanceEventsPipelineDeps {
  /** Same deps object as the spend delivery process; absent = no delivery
   *  consumer (events still append for a later replay-through). */
  webhookDelivery?: WebhookDeliveryProcessDeps;
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
  let pipeline = definePipeline<GovernanceEventsProcessingEvent>()
    .withName(GOVERNANCE_EVENTS_PIPELINE_NAME)
    .withAggregateType(GOVERNANCE_EVENTS_AGGREGATE_TYPE)
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand);
  if (deps.webhookDelivery) {
    pipeline = pipeline.withProcessManager(
      GOVERNANCE_EVENTS_PROCESS_NAME,
      governanceEventsDeliveryPM(deps.webhookDelivery),
    );
  }
  return pipeline.build();
}
