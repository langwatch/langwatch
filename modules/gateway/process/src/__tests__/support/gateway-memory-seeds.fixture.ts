/**
 * Rows a unit test writes through the gateway's memory twins: a virtual key and one request's
 * settled spend, with every column a twin needs and the test does not care about defaulted.
 */
import { Temporal } from "@langwatch/time";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import type { CreateGatewayVirtualKeyInput } from "../../repositories/gateway-virtual-key.repository.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";

/** A key on one team of its organization, named as the test names it. */
export function memoryVirtualKeySeed({
  id,
  name,
  organizationId,
}: {
  id: string;
  name: string;
  organizationId: string;
}): CreateGatewayVirtualKeyInput {
  return {
    id,
    organizationId,
    name,
    hashedSecret: `hash_${id}`,
    displayPrefix: "lw_vk_",
    config: {},
    createdById: "usr_1",
    scopes: [{ scopeType: "TEAM", scopeId: "team_1" }],
  };
}

/** One request's confirmed spend, as gateway_spend folds it. */
export function memorySpendStateSeed(
  overrides: Partial<GatewaySpendState> = {},
): GatewaySpendState {
  return {
    status: "confirmed",
    organizationId: "org_1",
    virtualKeyId: "vk_1",
    principalUserId: "",
    endUserId: "enduser-9",
    model: "gpt-5",
    providerKey: "prov_1",
    traceId: "trace_1",
    requestType: "chat",
    labels: [],
    metadataJson: "",
    podId: "",
    podSeq: 0,
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: 100, output_tokens: 50 },
    rateVersion: "catalog@2026-07-26",
    costNanoUsd: 4_200_000,
    errorType: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: Temporal.Instant.from("2026-07-20T12:00:00Z").epochMilliseconds,
    durationMs: 900,
    createdAt: 1,
    updatedAt: 1,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}
