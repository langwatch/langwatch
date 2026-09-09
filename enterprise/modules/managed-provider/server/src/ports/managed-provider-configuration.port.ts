import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

export abstract class ManagedProviderConfigurationPort {
  abstract tryForOrganization(organizationId: string): ManagedBedrockConfig | null;
}

export abstract class ManagedProviderConfigurationReporter {
  abstract info(attributes: Record<string, unknown>, message: string): void;
  abstract warn(attributes: Record<string, unknown>, message: string): void;
}
