/**
 * The hosted provider slot a connected install's gateway adds for one organization (ADR-156 §8).
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryGatewayConnectUpstreamRepository } from "../../repositories/memory/memory.gateway-connect-upstream.repository.ts";
import {
  CONNECT_LANGWATCH_PROVIDER_ID,
  GatewayConnectUpstreamService,
} from "../gateway-connect-upstream.service.ts";

const cipher = {
  encrypt: (plaintext: string) => `sealed(${plaintext})`,
  decrypt: (ciphertext: string) => ciphertext.replace(/^sealed\((.*)\)$/, "$1"),
};

const upstream = {
  organizationId: "org-1",
  baseUrl: "https://gateway.langwatch.ai/",
  token: `lwl_${"a1".repeat(32)}`,
  instanceId: "instance-1",
};

function harness() {
  const repository = MemoryGatewayConnectUpstreamRepository.create();
  return { repository, service: GatewayConnectUpstreamService.create({ repository, cipher }) };
}

describe("the hosted provider slot of a connected install", () => {
  it("keeps the license token encrypted at rest and reads it back whole", async () => {
    const { repository, service } = harness();

    await service.set(upstream);

    const [stored] = await repository.findForOrganization("org-1");
    expect(stored?.encryptedToken).toBe(cipher.encrypt(upstream.token));
    expect(await service.findForOrganization("org-1")).toEqual([upstream]);
  });

  it("is gone once licensing clears it, and clearing twice is harmless", async () => {
    const { service } = harness();
    await service.set(upstream);

    await service.clear({ organizationId: "org-1" });
    await service.clear({ organizationId: "org-1" });

    expect(await service.findForOrganization("org-1")).toEqual([]);
  });

  it("belongs to one organization only", async () => {
    const { service } = harness();
    await service.set(upstream);

    expect(await service.findForOrganization("org-2")).toEqual([]);
  });

  it("carries the license token, the instance id and the gateway endpoint, after the rest", () => {
    expect(GatewayConnectUpstreamService.providerSlot(upstream, 2)).toEqual({
      id: CONNECT_LANGWATCH_PROVIDER_ID,
      slot: "fallback_2",
      type: "langwatch",
      credentials: { api_key: upstream.token, instance_id: "instance-1" },
      base_url: "https://gateway.langwatch.ai/v1",
      models: [],
      config: {},
    });
  });
});
