import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

/**
 * The temporary AWS credentials a managed Bedrock call runs under.
 *
 * This module owns none of it — it is a message to AWS STS and back, not a
 * row this module persists — so it is a channel rather than a service. The
 * live tier speaks to AWS; the memory tier hands back a fixed, non-expiring
 * triple for tests.
 */
export type ManagedProviderCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export abstract class ManagedProviderCredentialVendor {
  abstract assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials>;
}
