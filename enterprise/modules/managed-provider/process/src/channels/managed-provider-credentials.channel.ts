import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

/**
 * This is a channel because credentials travel to and from AWS STS rather than
 * representing state this module owns.
 */
export type ManagedProviderCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export abstract class ManagedProviderCredentialVendor {
  abstract assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials>;
}
