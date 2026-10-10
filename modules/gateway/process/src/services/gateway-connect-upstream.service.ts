/**
 * The LangWatch-hosted provider a connected install's gateway reaches for one
 * organization (ADR-156 §8). The repository seals the token at rest; the slot goes after the
 * organization's own providers, so a customer credential keeps serving its models.
 */
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { GatewayConnectUpstream } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";

import type { GatewayConnectUpstreamRepository } from "../repositories/gateway-connect-upstream.repository.ts";
import type { ProviderSlot } from "../rules/gateway-config-wire.rules.ts";

/** The row id the synthesized slot carries: fixed, so a refresh never reads as a new provider. */
export const CONNECT_LANGWATCH_PROVIDER_ID = "connect-langwatch";

const logger = createLogger("langwatch:gateway:connect-upstream");

export class GatewayConnectUpstreamService {
  private constructor(
    private readonly repository: GatewayConnectUpstreamRepository,
    private readonly licensing: Pick<LicensingApi, "findConnectUpstream">,
  ) {}

  static create(input: {
    repository: GatewayConnectUpstreamRepository;
    licensing: Pick<LicensingApi, "findConnectUpstream">;
  }): GatewayConnectUpstreamService {
    return new GatewayConnectUpstreamService(input.repository, input.licensing);
  }

  /**
   * On licensing's set fact: pulls the upstream licensing derives now and seals it in. Licensing
   * serving none (its licence went since the fact) leaves the slot unset; a failed read throws, so
   * the delivery retries with the slot untouched.
   */
  async setFromLicensing({ organizationId }: { organizationId: string }): Promise<void> {
    const [upstream] = await this.licensing
      .findConnectUpstream({ organizationId })
      .catch((error: unknown) => {
        logger.warn({ organizationId, error }, "licensing refused the connect upstream read");
        throw error;
      });
    if (!upstream) {
      logger.warn({ organizationId }, "licensing serves no connect upstream; the slot stays unset");
      await this.repository.clear(organizationId);
      return;
    }
    await this.repository.save({
      organizationId,
      baseUrl: upstream.baseUrl,
      token: upstream.token,
      instanceId: upstream.instanceId,
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
      token: slot.token,
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
