import type { ModelProviderChannels } from "../model-provider.channels.ts";
import { MemoryModelProviderCodexGatewayPingChannel } from "./memory.model-provider-codex-gateway-ping.channel.ts";
import { MemoryModelProviderConnectionPingChannel } from "./memory.model-provider-connection-ping.channel.ts";

/** Every ping is recorded and answers "generated"; no vendor or gateway is reached. */
export class MemoryModelProviderChannels {
  static readonly requires = [] as const;

  static create(): ModelProviderChannels {
    return {
      connectionPing: MemoryModelProviderConnectionPingChannel.create(),
      codexGatewayPing: MemoryModelProviderCodexGatewayPingChannel.create(),
    };
  }
}
