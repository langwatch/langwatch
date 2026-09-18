import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import {
  type ManagedProviderCredentials,
  ManagedProviderCredentialVendor,
} from "../managed-provider-credentials.channel.ts";

const DEFAULT_CREDENTIALS: ManagedProviderCredentials = {
  accessKeyId: "memory-access-key-id",
  secretAccessKey: "memory-secret-access-key",
  sessionToken: "memory-session-token",
};

/** A fixed, non-expiring credential triple, for tests that compose no AWS account. */
export class MemoryManagedProviderCredentialsChannel extends ManagedProviderCredentialVendor {
  private constructor(private readonly credentials: ManagedProviderCredentials) {
    super();
  }

  static create(
    credentials: ManagedProviderCredentials = DEFAULT_CREDENTIALS,
  ): MemoryManagedProviderCredentialsChannel {
    return new MemoryManagedProviderCredentialsChannel(credentials);
  }

  async assumeCustomerRole(_config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    return this.credentials;
  }
}
