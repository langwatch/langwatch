import type { ManagedBedrockCredentials } from "@langwatch/enterprise-managed-provider-contract";

import { ModelProviderManagedGateway } from "./managed-model-provider-gateway.service.ts";

/**
 * The managed-provider answer for a deployment that has none. Named rather
 * than defaulted: "no organization is managed" is the true answer for every
 * self-hosted install, keeping one WITH managed providers from getting it by omission.
 */
export class UnmanagedModelProviderGatewayService extends ModelProviderManagedGateway {
  static create(): UnmanagedModelProviderGatewayService {
    return new UnmanagedModelProviderGatewayService();
  }

  private constructor() {
    super();
  }

  isManaged(_input: { organizationId: string; provider: string }): boolean {
    return false;
  }

  prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return Promise.resolve(input.parameters);
  }

  getBedrockCredentials(_input: { organizationId: string }): Promise<ManagedBedrockCredentials> {
    return Promise.reject(new Error("This deployment manages no Bedrock credentials."));
  }
}
