// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "~/server/event-sourcing/pipelines/governance-events/schemas/commands";

/**
 * Envelope builders for the governance families. Same envelope contract
 * as the spend events ({id, type, created, schema_version, data}); ids
 * are deterministic from the subject + action + identity of the change,
 * so redelivery and replay collapse at every dedup layer.
 */

interface GovernanceEnvelope {
  id: string;
  type: string;
  created: string;
  schema_version: "1";
  data: Record<string, unknown>;
}

export function vkLifecycleToEnvelope(
  data: RecordVkLifecycleCommandData,
): GovernanceEnvelope {
  const type = `gateway.virtual_key.${data.action}`;
  return {
    id: `${data.virtual_key_id}:${data.action}:${data.occurred_at}`,
    type,
    created: new Date(data.occurred_at).toISOString(),
    schema_version: "1",
    data: {
      event_id: `${data.virtual_key_id}:${data.action}:${data.occurred_at}`,
      event_type: type,
      organization_id: data.organization_id,
      virtual_key_id: data.virtual_key_id,
      name: data.name,
      display_prefix: data.display_prefix,
      reason: data.reason,
      occurred_at: new Date(data.occurred_at).toISOString(),
    },
  };
}

export function budgetCrossingToEnvelope(
  data: RecordBudgetCrossingCommandData,
): GovernanceEnvelope {
  const type =
    data.kind === "breached"
      ? "gateway.budget.breached"
      : "gateway.budget.threshold_crossed";
  const id = `${data.budget_id}:${data.bucket_scope_id}:${data.kind}:${data.period_started_at_ms}`;
  return {
    id,
    type,
    created: new Date(data.occurred_at).toISOString(),
    schema_version: "1",
    data: {
      event_id: id,
      event_type: type,
      organization_id: data.organization_id,
      budget_id: data.budget_id,
      scope_type: data.scope_type,
      bucket_scope_id: data.bucket_scope_id,
      end_user_id: data.end_user_id,
      window: data.window,
      period_started_at: new Date(data.period_started_at_ms).toISOString(),
      limit_usd: data.limit_usd,
      spent_usd: data.spent_usd,
      on_breach: data.on_breach,
      occurred_at: new Date(data.occurred_at).toISOString(),
    },
  };
}
