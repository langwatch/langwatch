import type { Event, IntentContext, ProcessStore } from "@langwatch/eventing";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/enterprise-governance-contract";

export { GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE, GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE };
export type GovernanceVkLifecycleData = RecordVkLifecycleCommandData;
export type GovernanceBudgetCrossingData = RecordBudgetCrossingCommandData;

export type GovernanceEventsProcessingEvent =
  | (Event<GovernanceVkLifecycleData> & {
      type: typeof GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE;
    })
  | (Event<GovernanceBudgetCrossingData> & {
      type: typeof GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE;
    });

export type GovernanceWebhookEnvelope = {
  id: string;
  type: string;
  created: string;
  schema_version: "1";
  data: Record<string, string | null>;
};

export type GovernanceWebhookSendBatch = {
  organizationId: string;
  endpointId: string;
  batchId: string;
  envelopes: GovernanceWebhookEnvelope[];
};

export abstract class GovernanceWebhookPort {
  abstract readonly processStore: ProcessStore;
  abstract readonly maxAttempts: number;

  abstract webhooksEnabled(organizationId: string): Promise<boolean>;
  abstract activeEndpointIds(input: {
    organizationId: string;
    eventType: string;
  }): Promise<string[]>;
  abstract sendBatch(payload: GovernanceWebhookSendBatch, context: IntentContext): Promise<void>;
  abstract retryDelayMs(input: { attempt: number }): number;
  abstract now(): number;
}
