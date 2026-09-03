import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

export type ManagedProviderCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export abstract class ManagedProviderCredentialsPort {
  abstract assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials>;
}
