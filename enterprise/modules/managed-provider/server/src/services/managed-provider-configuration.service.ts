import type {
  ManagedBedrockConfig,
  ManagedBedrockDirectory,
} from "@langwatch/enterprise-managed-provider-contract";

export abstract class ManagedProviderConfiguration {
  abstract tryForOrganization(organizationId: string): ManagedBedrockConfig | null;
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

  tryForOrganization(organizationId: string): ManagedBedrockConfig | null {
    return this.directory[organizationId] ?? null;
  }
}
