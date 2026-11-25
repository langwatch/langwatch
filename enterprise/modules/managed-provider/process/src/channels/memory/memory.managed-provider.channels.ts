import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

import {
  type ManagedProviderCredentials,
  ManagedProviderCredentialVendor,
} from "../managed-provider-credentials.channel.ts";
import type { ManagedProviderChannels } from "../managed-provider.channels.ts";

const DEFAULT_CREDENTIALS: ManagedProviderCredentials = {
  accessKeyId: "memory-access-key-id",
  secretAccessKey: "memory-secret-access-key",
  sessionToken: "memory-session-token",
};

/** A fixed, non-expiring credential triple, for tests that compose no AWS account. */
class MemoryManagedProviderCredentialsChannel extends ManagedProviderCredentialVendor {
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

/** A fixed credential, so a memory install never reaches AWS. */
export class MemoryManagedProviderChannels {
  static readonly requires = [] as const;

  static create(): ManagedProviderChannels {
    return { credentials: MemoryManagedProviderCredentialsChannel.create() };
  }
}
