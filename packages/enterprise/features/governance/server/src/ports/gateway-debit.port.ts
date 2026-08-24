import type { Event } from "@langwatch/eventing";

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE =
  "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE =
  "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE =
  "lw.gateway.spend.failed" as const;

export type GatewaySpendUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_1h_tokens: number;
  reasoning_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
  input_chars: number;
  audio_ms: number;
};

export type GatewaySpendAttribution = {
  organization_id: string;
  team_id: string;
  virtual_key_id: string;
  principal_user_id: string;
  end_user_id: string;
};

export type GatewaySpendAdmittedData = GatewaySpendAttribution & {
  gateway_request_id: string;
  outcome_carries_attribution: boolean;
};

export type GatewaySpendOutcomeData = GatewaySpendAttribution & {
  gateway_request_id: string;
  model: string;
  model_provider_id: string;
  usage: GatewaySpendUsage | null;
  cost_nano_usd: number;
  rate_version: string;
  duration_ms: number;
  occurred_at: number;
};

export type GatewaySpendFailedData = GatewaySpendOutcomeData & {
  error: { type: string; http_status: number };
};

export type GatewaySpendProcessingEvent =
  | (Event<GatewaySpendAdmittedData> & {
      type: typeof GATEWAY_SPEND_ADMITTED_EVENT_TYPE;
    })
  | (Event<GatewaySpendOutcomeData> & {
      type: typeof GATEWAY_SPEND_CONFIRMED_EVENT_TYPE;
    })
  | (Event<GatewaySpendFailedData> & {
      type: typeof GATEWAY_SPEND_FAILED_EVENT_TYPE;
    });

export type GatewayBudgetDefinition = {
  id: string;
  scopeType: string;
  window: string;
  onBreach: "BLOCK" | "WARN";
};

export type GatewayResolvedBudget = {
  budget: GatewayBudgetDefinition;
  bucketScopeId: string;
  endUserId: string | null;
};

export type GatewayBudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: string;
  scopeId: string;
  window: string;
  virtualKeyId: string;
  providerKey: string | null;
  gatewayRequestId: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  durationMs: number;
  status: "SUCCESS" | "BLOCKED_BY_GUARDRAIL" | "PROVIDER_ERROR";
  occurredAt: Date;
};

export type GatewayBudgetCrossingCandidate = {
  tenantId: string;
  budgetId: string;
  bucketScopeId: string;
  endUserId: string | null;
};

export abstract class GatewayDebitPort {
  abstract resolve(input: {
    target: {
      organizationId: string;
      teamId: string | null;
      projectId: string;
      virtualKeyId: string;
      principalUserId: string | null;
      endUserId: string | null;
    };
    providerKey: string | null;
  }): Promise<GatewayResolvedBudget[]>;

  abstract insert(rows: GatewayBudgetDebitRow[]): Promise<void>;

  abstract detectCrossings(
    rows: GatewayBudgetCrossingCandidate[],
  ): Promise<void>;

  abstract shouldEmitBudgetUpdated(input: {
    projectId: string;
  }): Promise<boolean>;

  abstract emitBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void>;
}
