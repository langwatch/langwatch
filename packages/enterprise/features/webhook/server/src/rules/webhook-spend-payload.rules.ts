// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  DeliverInstance,
  DeliverPayload,
  FailSpendCommandData,
  SettleSpendCommandData,
  SpendAttribution,
  WebhookDeliveryState,
} from "./webhook-delivery-contract.rules.ts";
import type { WebhookSpendEventRow } from "../services/webhook-envelope.service.ts";

/** The columns admission's attribution owns. A row whose process instance
 *  never saw an `admitted` event still needs every one of them, so each
 *  falls back to the empty value the spend log stores. */
export function attributedColumns(
  attribution: DeliverPayload["attribution"],
): Pick<
  WebhookSpendEventRow,
  | "organizationId"
  | "virtualKeyId"
  | "principalUserId"
  | "endUserId"
  | "traceId"
  | "requestType"
  | "labels"
  | "metadata"
> {
  return {
    organizationId: attribution?.organization_id ?? "",
    virtualKeyId: attribution?.virtual_key_id ?? "",
    principalUserId: attribution?.principal_user_id ?? "",
    endUserId: attribution?.end_user_id ?? "",
    traceId: attribution?.trace_id ?? "",
    requestType: attribution?.request_type ?? "",
    labels: attribution?.labels ?? [],
    metadata: attribution?.metadata ?? "",
  };
}

/** The RESOLVED model identity when the outcome carried one, else the
 *  identity admission requested. `fallback` is what a request that named
 *  neither stores. */
export function resolvedModel(payload: DeliverPayload, fallback: string): string {
  return payload.model || payload.attribution?.model || fallback;
}

/** Settled requests are their own event type: an endpoint subscribed only
 *  to completed never receives one, and a family or match-all subscription
 *  receives both. */
export function deliveryEventType(status: DeliverPayload["status"]): string {
  return status === "settled" ? "gateway.request.settled" : "gateway.request.completed";
}

/** Every outcome fills the same deliver payload. Fields an outcome does
 *  not carry stay at the log's empty values, so the envelope mapper never
 *  special-cases a missing one. */
export function deliverPayloadFor(
  outcome: Pick<DeliverPayload, "status" | "gateway_request_id" | "occurred_at"> &
    Partial<DeliverPayload>,
  instance: DeliverInstance,
): DeliverPayload {
  return {
    project_id: instance.projectId,
    attribution: instance.attribution,
    model: "",
    model_provider_id: "",
    usage: null,
    cost_nano_usd: 0,
    rate_version: "",
    duration_ms: 0,
    error: null,
    settle_reason: null,
    ...outcome,
  };
}

/** A confirmed request carries the resolved model identity, the usage it
 *  billed, and the price with the rate version it was priced at. */
export function confirmedDeliverPayload(
  confirmed: ConfirmSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "confirmed",
      gateway_request_id: confirmed.gateway_request_id,
      occurred_at: confirmed.occurred_at,
      model: confirmed.model,
      model_provider_id: confirmed.model_provider_id,
      usage: confirmed.usage,
      cost_nano_usd: confirmed.cost_nano_usd,
      rate_version: confirmed.rate_version,
      duration_ms: confirmed.duration_ms,
    },
    instance,
  );
}

/** A failed request carries whatever usage the provider reported before
 *  the error, priced the same way a confirmation is. */
export function failedDeliverPayload(
  failed: FailSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "failed",
      gateway_request_id: failed.gateway_request_id,
      occurred_at: failed.occurred_at,
      model: failed.model,
      model_provider_id: failed.model_provider_id,
      usage: failed.usage,
      cost_nano_usd: failed.cost_nano_usd,
      rate_version: failed.rate_version,
      duration_ms: failed.duration_ms,
      error: failed.error,
    },
    instance,
  );
}

/** A settled request is a reservation released without an outcome: no
 *  model, no usage, and nothing priced, only why it settled. */
export function settledDeliverPayload(
  settled: SettleSpendCommandData,
  instance: DeliverInstance,
): DeliverPayload {
  return deliverPayloadFor(
    {
      status: "settled",
      gateway_request_id: settled.gateway_request_id,
      occurred_at: settled.occurred_at,
      settle_reason: settled.reason,
    },
    instance,
  );
}

/**
 * The state an outcome that outran its admission leaves behind. Precedence
 * mirrors the fold's status lattice: a real outcome (confirmed or failed)
 * always takes the slot, a settlement only fills an empty one, so the
 * envelope admission finally releases is the one the ledger agrees with.
 */
export function withStashedOutcome(
  state: WebhookDeliveryState,
  incoming: DeliverPayload,
): WebhookDeliveryState {
  const keepStashed = incoming.status === "settled" && state.pendingOutcome !== null;

  return {
    ...state,
    pendingOutcome: keepStashed ? state.pendingOutcome : incoming,
  };
}

/**
 * The attribution an outcome states about itself, or null when it states
 * none.
 *
 * Every outcome carries it from the build that sets
 * `outcome_carries_attribution` on its admissions; an older build's outcomes
 * carry nothing and fall back to the admission this instance remembered.
 * The organization is the discriminator because delivery cannot resolve a
 * single endpoint without it.
 */
export function attributionFromOutcome(
  data: ConfirmSpendCommandData | FailSpendCommandData | SettleSpendCommandData,
): SpendAttribution | null {
  if (!data.organization_id) {
    return null;
  }

  return {
    organization_id: data.organization_id,
    virtual_key_id: data.virtual_key_id,
    principal_user_id: data.principal_user_id,
    end_user_id: data.end_user_id,
    // Every outcome states a model identity. A confirmation or failure
    // states the one it RESOLVED; a settlement resolved none, so the
    // sweeper copies the identity admission requested off the spend record
    // — which is what a settled envelope has always named.
    model: data.model,
    model_provider_id: data.model_provider_id,
    trace_id: data.trace_id,
    request_type: data.request_type,
    labels: data.labels,
    metadata: data.metadata,
    admitted_at: data.admitted_at,
  };
}

export function attributionFrom(data: AdmitSpendCommandData): SpendAttribution {
  return {
    organization_id: data.organization_id,
    virtual_key_id: data.virtual_key_id,
    principal_user_id: data.principal_user_id,
    end_user_id: data.end_user_id,
    model: data.model,
    model_provider_id: data.model_provider_id,
    trace_id: data.trace_id,
    request_type: data.request_type,
    labels: data.labels,
    metadata: data.metadata,
    admitted_at: data.occurred_at,
  };
}
