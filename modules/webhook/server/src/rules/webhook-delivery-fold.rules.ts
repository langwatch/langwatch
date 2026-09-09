// SPDX-License-Identifier: Apache-2.0

/**
 * How a delivery decides, with no store and no network in reach: the retry ladder's next
 * delay, the spend row an envelope becomes, which process key names an endpoint stream, and
 * the two folds that turn a spend admission or outcome into the intents it emits.
 */

import { nanoUsdToDecimalString } from "@langwatch/gateway-contract";
import {
  attributedColumns,
  attributionFrom,
  attributionFromOutcome,
  resolvedModel,
  withStashedOutcome,
} from "./webhook-spend-payload.rules.ts";
import type { WebhookSpendEventRow } from "../services/webhook-envelope.service.ts";
import {
  EMPTY_SPEND_USAGE,
  WEBHOOK_RETRY_LADDER_MS,
  type AdmitSpendCommandData,
  type ConfirmSpendCommandData,
  type DeliverPayload,
  type EndpointStreamState,
  type FailSpendCommandData,
  type SettleSpendCommandData,
  type DeliverInstance,
  type WebhookDeliveryState,
} from "./webhook-delivery-contract.rules.ts";
import { Temporal, toEpochMs } from "@langwatch/time";

/** What an outcome handler needs from the process context. */
export interface DeliverOutcomeContext<Intent> {
  projectId: string;
  intents: { deliver: (key: string, payload: DeliverPayload) => Intent };
}

/** The delay before the attempt after the 1-based `attempt` that just failed. */
export function retryDelayMs({ attempt }: { attempt: number }): number {
  return (
    WEBHOOK_RETRY_LADDER_MS[attempt - 1] ??
    WEBHOOK_RETRY_LADDER_MS[WEBHOOK_RETRY_LADDER_MS.length - 1]!
  );
}

export function isEndpointStreamKey(processKey: string): boolean {
  return processKey.startsWith("endpoint:");
}

/** The delivery view as a spend row, so the envelope mapper stays the one
 *  place the external contract is shaped. The price is the one the outcome
 *  event carried, never a fresh rating and never a read of the fold's
 *  table: the log's consumers stay independent AND state the same cost. */
export function payloadToRow(payload: DeliverPayload): WebhookSpendEventRow {
  const usage = payload.usage ?? EMPTY_SPEND_USAGE;

  return {
    ...attributedColumns(payload.attribution),
    tenantId: payload.project_id,
    gatewayRequestId: payload.gateway_request_id,
    teamId: "",
    model: resolvedModel(payload, ""),
    providerKey: payload.model_provider_id || payload.attribution?.model_provider_id || "",
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensCacheRead: usage.cache_read_input_tokens,
    tokensCacheWrite: usage.cache_creation_input_tokens,
    tokensReasoning: usage.reasoning_tokens,
    costNanoUsd: payload.cost_nano_usd,
    costUsd: nanoUsdToDecimalString(payload.cost_nano_usd),
    rateVersion: payload.rate_version,
    status: payload.status,
    errorClass: payload.error?.type ?? "",
    httpStatus: payload.error?.http_status ?? 0,
    needsReconciliation: payload.status === "settled",
    settleReason: payload.settle_reason ?? "",
    durationMs: payload.duration_ms,
    occurredAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(payload.occurred_at)),
  };
}

export function endpointFlushTarget(
  state: WebhookDeliveryState,
  key: string,
): { endpointId: string; organizationId: string } | null {
  if (!isEndpointStreamKey(key)) {
    return null;
  }

  const stream = state as unknown as EndpointStreamState;
  const organizationId = stream.pending[0]?.envelope.data?.organization_id;
  if (typeof organizationId !== "string" || organizationId === "") {
    return null;
  }

  return { endpointId: key.slice("endpoint:".length), organizationId };
}

/**
 * One outcome, routed by what it can see. All three route identically, so
 * they share this rather than repeating it with a different payload builder.
 *
 * An outcome that states its own attribution freezes its deliver intent
 * immediately and leaves the state untouched, so the evolution is transient
 * and the request costs no durable row. One that does not falls back to the
 * admission this instance remembered: stashed until admission arrives,
 * released by it after.
 */
export function onSpendOutcome<
  Intent,
  Data extends ConfirmSpendCommandData | FailSpendCommandData | SettleSpendCommandData,
>({
  state,
  ctx,
  status,
  data,
  toPayload,
}: {
  state: WebhookDeliveryState;
  ctx: DeliverOutcomeContext<Intent>;
  status: DeliverPayload["status"];
  data: Data;
  toPayload: (data: Data, instance: DeliverInstance) => DeliverPayload;
}): { state: WebhookDeliveryState; intents?: Intent[] } {
  const attribution = attributionFromOutcome(data) ?? state.attribution;
  const payload = toPayload(data, { projectId: ctx.projectId, attribution });
  if (attribution === null) {
    return { state: withStashedOutcome(state, payload) };
  }

  return {
    state,
    intents: [ctx.intents.deliver(`deliver:${status}`, payload)],
  };
}

/**
 * The admission: the one place a request's attribution is known.
 *
 * It releases an outcome that arrived ahead of it on BOTH paths, including
 * the one where it remembers nothing. A stash is not expected there — an
 * outcome only stashes when it carried no attribution, and admission and
 * outcome always come from the same pod and the same build — but the two
 * conditions are not the same one: an outcome stashes on its OWN empty
 * organization, not on the build that sent it. Where they disagree, dropping
 * the stash would cost the envelope and strand the instance row holding it,
 * since this handler is the only thing that could ever clear it.
 */
export function onAdmission<Intent>({
  state,
  ctx,
  admit,
}: {
  state: WebhookDeliveryState;
  ctx: DeliverOutcomeContext<Intent>;
  admit: AdmitSpendCommandData;
}): { state: WebhookDeliveryState; intents?: Intent[] } {
  const attribution = attributionFrom(admit);
  const stashed = state.pendingOutcome;
  const release = stashed
    ? [ctx.intents.deliver("deliver:late", { ...stashed, attribution })]
    : void 0;

  // Every outcome states the attribution itself, so there is nothing worth
  // remembering and this admission writes no row.
  if (admit.outcome_carries_attribution) {
    if (!stashed) {
      return { state };
    }

    return { state: { ...state, pendingOutcome: null }, intents: release };
  }

  const admitted = { ...state, attribution, pendingOutcome: null };

  return stashed ? { state: admitted, intents: release } : { state: admitted };
}
