/**
 * The LangWatch-hosted provider a connected install's gateway reaches for one
 * organization (ADR-156 §8). The token rests encrypted; the slot goes after the
 * organization's own providers, so a customer credential keeps serving its models.
 */
import type { GatewayConnectUpstream } from "@langwatch/gateway-contract";

import type { GatewayConnectUpstreamRepository } from "../repositories/gateway-connect-upstream.repository.ts";
import type { ProviderSlot } from "../rules/gateway-config-wire.rules.ts";

/** The row id the synthesized slot carries: fixed, so a refresh never reads as a new provider. */
export const CONNECT_LANGWATCH_PROVIDER_ID = "connect-langwatch";

export type GatewayConnectUpstreamCipher = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

export class GatewayConnectUpstreamService {
  private constructor(
    private readonly repository: GatewayConnectUpstreamRepository,
    private readonly cipher: GatewayConnectUpstreamCipher,
  ) {}

  static create(input: {
    repository: GatewayConnectUpstreamRepository;
    cipher: GatewayConnectUpstreamCipher;
  }): GatewayConnectUpstreamService {
    return new GatewayConnectUpstreamService(input.repository, input.cipher);
  }

  async set(input: GatewayConnectUpstream): Promise<void> {
    await this.repository.save({
      organizationId: input.organizationId,
      baseUrl: input.baseUrl,
      encryptedToken: this.cipher.encrypt(input.token),
      instanceId: input.instanceId,
    });
  }

  async clear(input: { organizationId: string }): Promise<void> {
    await this.repository.clear(input.organizationId);
  }

  /** The organization's upstream with its token readable, or an empty list. */
  async findForOrganization(organizationId: string): Promise<GatewayConnectUpstream[]> {
    const stored = await this.repository.findForOrganization(organizationId);
    return stored.map((slot) => ({
      organizationId: slot.organizationId,
      baseUrl: slot.baseUrl,
      token: this.cipher.decrypt(slot.encryptedToken),
      instanceId: slot.instanceId,
    }));
  }

  /** The dispatch-chain slot the upstream becomes, named for its place after `index` others. */
  static providerSlot(upstream: GatewayConnectUpstream, index: number): ProviderSlot {
    return {
      id: CONNECT_LANGWATCH_PROVIDER_ID,
      slot: `fallback_${index}`,
      type: "langwatch",
      credentials: { api_key: upstream.token, instance_id: upstream.instanceId },
      base_url: `${upstream.baseUrl.replace(/\/+$/, "")}/v1`,
      models: [],
      config: {},
    };
  }
}
