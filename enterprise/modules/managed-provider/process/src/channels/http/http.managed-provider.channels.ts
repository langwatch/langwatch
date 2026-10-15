import type { ManagedProviderServerConfig } from "@langwatch/enterprise-managed-provider-contract";

import type { ManagedProviderChannels } from "../managed-provider.channels.ts";
import { HttpManagedProviderCredentialsChannel } from "./http.managed-provider-credentials.channel.ts";

/** Credentials come from AWS STS (or the configured STS base), assumed per call. */
export class HttpManagedProviderChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: ManagedProviderServerConfig }): ManagedProviderChannels {
    return {
      credentials: HttpManagedProviderCredentialsChannel.create({ stsBase: config.stsBase }),
    };
  }
}
