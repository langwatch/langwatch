import type { ManagedProviderChannels } from "../managed-provider.channels.ts";
import { HttpManagedProviderCredentialsChannel } from "./http.managed-provider-credentials.channel.ts";

/** Credentials come from AWS STS, assumed per call. */
export class HttpManagedProviderChannels {
  static readonly requires = [] as const;

  static create(): ManagedProviderChannels {
    return { credentials: HttpManagedProviderCredentialsChannel.create() };
  }
}
