import type { Event, IntentContext, ProcessStore } from "@langwatch/eventing";

export const GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE =
  "lw.governance.vk_lifecycle" as const;
export const GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE =
  "lw.governance.budget_crossing" as const;

export type GovernanceVkLifecycleData = {
  tenantId: string;
  organization_id: string;
  virtual_key_id: string;
  action: "created" | "rotated" | "disabled" | "enabled" | "revoked";
  name: string;
  display_prefix: string;
  reason: string | null;
  occurred_at: number;
};

export type GovernanceBudgetCrossingData = {
  tenantId: string;
  organization_id: string;
  budget_id: string;
  kind: "threshold_crossed" | "breached";
  scope_type: string;
  bucket_scope_id: string;
  end_user_id: string | null;
  virtual_key_id: string | null;
  anchor_project_id: string | null;
  window: string;
  period_started_at_ms: number;
  limit_usd: string;
  spent_usd: string;
  on_breach: "block" | "warn";
  occurred_at: number;
};

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
  abstract sendBatch(
    payload: GovernanceWebhookSendBatch,
    context: IntentContext,
  ): Promise<void>;
  abstract retryDelayMs(input: { attempt: number }): number;
  abstract now(): number;
}
