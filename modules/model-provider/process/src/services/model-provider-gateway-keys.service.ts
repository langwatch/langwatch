import type { ManagedBedrockCredentials } from "@langwatch/enterprise-managed-provider-contract";
import {
  ModelProviderCustomKeysMissingError,
  type ModelProviderCustomKeys,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { nowEpochMs } from "@langwatch/time";

import type { ModelProviderRepository } from "../repositories/model-provider.repository.ts";
import type { ModelProviderCatalog } from "./registry-model-provider-catalog.service.ts";

const logger = createLogger("langwatch:model-provider:gateway-keys");

/** Shorter than the one-hour session a role hop mints, so the gateway re-reads keys in time. */
const MANAGED_SESSION_RENEWAL_MS = 45 * 60 * 1000;

type ModelProviderGatewayKeysOptions = {
  repository: ModelProviderRepository;
  catalog: ModelProviderCatalog;
};

/** A managed Bedrock session in the row's own field names, its private endpoint included. */
function managedBedrockKeys(session: ManagedBedrockCredentials): Record<string, string> {
  return {
    AWS_ACCESS_KEY_ID: session.accessKeyId,
    AWS_SECRET_ACCESS_KEY: session.secretAccessKey,
    AWS_SESSION_TOKEN: session.sessionToken,
    AWS_REGION_NAME: session.region,
    AWS_BEDROCK_RUNTIME_ENDPOINT: session.runtimeEndpoint,
  };
}

/** A row's stored keys minus the runtime endpoint, which only a minted managed session may set. */
function storedGatewayKeys(customKeys: Record<string, unknown> | null): Record<string, unknown> {
  const { AWS_BEDROCK_RUNTIME_ENDPOINT: _mintedOnly, ...stored } = customKeys ?? {};
  return stored;
}

/** The keys the AI gateway runs a row with, and when it must read them again. */
export class ModelProviderGatewayKeysService {
  private constructor(private readonly options: ModelProviderGatewayKeysOptions) {}

  static create(options: ModelProviderGatewayKeysOptions): ModelProviderGatewayKeysService {
    return new ModelProviderGatewayKeysService(options);
  }

  /**
   * The row's stored keys, and for a managed Bedrock organization the customer role's session
   * and private endpoint. A failed role hop logs and leaves the stored keys, so only this row
   * fails and the key's other providers keep serving.
   */
  async getCustomKeys(input: { modelProviderId: string }): Promise<ModelProviderCustomKeys> {
    const row = await this.options.repository.getById({ id: input.modelProviderId });
    const owner = { id: row.id, provider: row.provider, organizationId: row.organizationId };
    const managed = this.options.catalog.isManagedProvider({
      organizationId: row.organizationId,
      provider: row.provider,
    });
    if (managed) {
      try {
        const session = await this.options.catalog.getManagedBedrockCredentials({
          organizationId: row.organizationId,
        });
        return {
          ...owner,
          customKeys: { ...storedGatewayKeys(row.customKeys), ...managedBedrockKeys(session) },
        };
      } catch (error) {
        logger.warn(
          { modelProviderId: row.id, error },
          "Managed Bedrock credentials could not be minted; the row keeps its stored keys",
        );
      }
    }
    if (!row.customKeys) throw new ModelProviderCustomKeysMissingError();
    return { ...owner, customKeys: storedGatewayKeys(row.customKeys) };
  }

  getEpoch(input: { organizationId: string }): string {
    const managed = this.options.catalog.isManagedProvider({
      organizationId: input.organizationId,
      provider: "bedrock",
    });
    return managed ? `managed-${Math.floor(nowEpochMs() / MANAGED_SESSION_RENEWAL_MS)}` : "";
  }
}
