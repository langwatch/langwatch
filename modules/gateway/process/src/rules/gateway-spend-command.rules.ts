/** The spend-command spine's record shapes that need nothing but the record. */
import type {
  GatewayInternalSpendCommandRecord,
  GatewayPricedSpend,
  GatewayProviderUsage,
  SpendUsage,
} from "@langwatch/gateway-contract";

import { EMPTY_SPEND_USAGE } from "./gateway-spend-projection.rules.ts";

export const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";

/**
 * The spine's confirmed-outcome shape for a self-priced outcome: no admission
 * in front of it, no virtual key and no provider, and the price and its stamp
 * exactly as the caller resolved them.
 */
export function pricedSpendCommandData(input: GatewayPricedSpend): Record<string, unknown> {
  return {
    gateway_request_id: input.requestId,
    occurred_at: input.occurredAt,
    tenantId: input.projectId,
    model: input.model,
    model_provider_id: "",
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: input.inputTokens },
    rate_version: input.rateVersion,
    duration_ms: 0,
    organization_id: input.organizationId,
    virtual_key_id: input.virtualKeyId ?? "",
    end_user_id: "",
    trace_id: "",
    request_type: input.requestType,
    labels: [],
    metadata: input.metadata ?? "",
    admitted_at: 0,
    cost_nano_usd: input.costNanoUsd,
    principal_user_id: "",
    team_id: input.teamId,
  };
}

/**
 * The spine's confirmed-outcome shape for a call LangWatch made with stored provider
 * credentials: no admission and no virtual key, the provider row it ran on, and the price the
 * registry rated its quantities at. The organization is set, so the debit writer charges it.
 */
export function providerUsageCommandData({
  input,
  usage,
  rated,
  organizationId,
  teamId,
  modelProviderId,
}: {
  input: GatewayProviderUsage;
  usage: SpendUsage;
  rated: { costNanoUsd: number; rateVersion: string };
  organizationId: string;
  teamId: string;
  modelProviderId: string;
}): Record<string, unknown> {
  return {
    gateway_request_id: input.requestId,
    occurred_at: input.occurredAt,
    tenantId: input.projectId,
    model: input.model,
    model_provider_id: modelProviderId,
    usage,
    rate_version: rated.rateVersion,
    duration_ms: Math.max(0, Math.round(input.durationMs ?? 0)),
    organization_id: organizationId,
    virtual_key_id: "",
    end_user_id: "",
    trace_id: "",
    request_type: input.requestType,
    labels: [],
    metadata: "",
    admitted_at: 0,
    cost_nano_usd: rated.costNanoUsd,
    principal_user_id: "",
    team_id: teamId,
  };
}

/**
 * The wire fields that identify a rejected record, so the log line can be
 * reconciled against the gateway's own. Read defensively: a record is only
 * rejected because its payload did not hold up.
 */
export function rejectedRecordIdentity(
  record: GatewayInternalSpendCommandRecord,
): Record<string, string | null> {
  const wireString = (key: string): string | null => {
    const value = record.payload[key];

    return typeof value === "string" && value.length > 0 ? value : null;
  };

  return { gatewayRequestId: wireString("gateway_request_id"), tenantId: wireString("project_id") };
}

/**
 * The ids an attributed record was validated with. Required on an admission, so
 * those reads are total; an outcome from a build that predates
 * attribution-on-outcome carries empty strings instead.
 */
export function attributedIdentity(command: Record<string, unknown>): {
  gatewayRequestId: string;
  virtualKeyId: string;
  projectId: string;
  organizationId: string;
} {
  return {
    gatewayRequestId: asString(command.gateway_request_id),
    virtualKeyId: asString(command.virtual_key_id),
    projectId: asString(command.tenantId),
    organizationId: asString(command.organization_id),
  };
}
