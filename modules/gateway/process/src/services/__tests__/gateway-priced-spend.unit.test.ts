/**
 * A self-priced outcome goes straight onto the pipeline's `confirmSpend`: the
 * drain path re-rates every outcome against the model registry, which holds no
 * entry for a judgement or a brokered session.
 */
import type { GatewayPricedSpend } from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
  type GatewayInternalSpendPipeline,
} from "../gateway-internal-protocol.service.ts";

const PRICED: GatewayPricedSpend = {
  requestId: "instanteval_run-1",
  projectId: "project-1",
  organizationId: "org-1",
  teamId: "team-1",
  requestType: "instant_eval",
  model: "jev",
  rateVersion: "instant_eval@0.8x1.3",
  inputTokens: 12_000,
  costNanoUsd: 13_000_000,
  metadata: '{"instant_eval":{"cost_usd":0.01}}',
  occurredAt: 1_758_534_000_000,
};

/** Only what this suite named; everything else refuses by name. */
function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);

      throw new Error(
        `recordPricedSpend reached "${String(property)}", which this test did not supply`,
      );
    },
  });
}

function serviceOver({ withPipeline }: { withPipeline: boolean }) {
  const sent: Record<string, unknown>[] = [];
  const spend: GatewayInternalSpendPipeline = {
    commands: {
      confirmSpend: {
        send: async (payload) => {
          sent.push({ ...(payload as Record<string, unknown>) });
        },
      },
    },
    rating: {
      rate: () => {
        throw new Error("a self-priced outcome must not be re-rated");
      },
    },
  };

  return {
    sent,
    service: GatewayInternalProtocolService.create(
      suppliedMembers(withPipeline ? { spend } : { spend: undefined }),
    ),
  };
}

describe("recordPricedSpend", () => {
  it("appends one confirmed outcome carrying the caller's own price and stamp", async () => {
    const { sent, service } = serviceOver({ withPipeline: true });

    expect(await service.recordPricedSpend(PRICED)).toEqual({ status: "recorded" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      gateway_request_id: "instanteval_run-1",
      tenantId: "project-1",
      organization_id: "org-1",
      team_id: "team-1",
      request_type: "instant_eval",
      model: "jev",
      rate_version: "instant_eval@0.8x1.3",
      cost_nano_usd: 13_000_000,
      occurred_at: 1_758_534_000_000,
    });
  });

  it("states it has no admission, no virtual key and no provider, so the sweeper never sees it", async () => {
    const { sent, service } = serviceOver({ withPipeline: true });

    await service.recordPricedSpend(PRICED);

    expect(sent[0]).toMatchObject({
      admitted_at: 0,
      virtual_key_id: "",
      model_provider_id: "",
      duration_ms: 0,
    });
  });

  it("carries only the input tokens it was given, the rest of the usage at zero", async () => {
    const { sent, service } = serviceOver({ withPipeline: true });

    await service.recordPricedSpend(PRICED);

    expect(sent[0]?.usage).toMatchObject({ input_tokens: 12_000, output_tokens: 0, audio_ms: 0 });
  });

  it("answers unavailable, not a fault, on a process with no spend pipeline registered", async () => {
    const { sent, service } = serviceOver({ withPipeline: false });

    expect(await service.recordPricedSpend(PRICED)).toEqual({ status: "unavailable" });
    expect(sent).toEqual([]);
  });
});
