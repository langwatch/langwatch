import type {
  ManagedBedrockConfig,
  ManagedBedrockDirectory,
} from "@langwatch/enterprise-managed-provider-contract";

export type ManagedBedrockDeployment =
  | { kind: "managed"; config: ManagedBedrockConfig }
  | { kind: "unmanaged" };

export abstract class ManagedProviderConfiguration {
  abstract getBedrockDeployment(organizationId: string): ManagedBedrockDeployment;
}

/**
 * Which managed Bedrock deployment an organization is served by. The directory
 * arrives parsed and validated, so a malformed one refuses the boot rather than
 * being skipped here with a warning nobody reads. What is left is the lookup.
 */
export class ManagedProviderConfigurationService extends ManagedProviderConfiguration {
  private constructor(private readonly directory: ManagedBedrockDirectory) {
    super();
  }

  static create(options: {
    bedrock: ManagedBedrockDirectory;
  }): ManagedProviderConfigurationService {
    return new ManagedProviderConfigurationService(options.bedrock);
  }

  getBedrockDeployment(organizationId: string): ManagedBedrockDeployment {
    const config = this.directory[organizationId];
    return config ? { kind: "managed", config } : { kind: "unmanaged" };
  }
}
