import type { BoundApis } from "@langwatch/process";
import { TraceApi } from "@langwatch/trace-contract";

import type { ModelProviderChannels } from "../model-provider.channels.ts";
import { MemoryModelProviderCodexGatewayPingChannel } from "./memory.model-provider-codex-gateway-ping.channel.ts";
import { MemoryModelProviderConnectionPingChannel } from "./memory.model-provider-connection-ping.channel.ts";

/** Every ping is recorded and answers "generated"; spans read through the bound trace module. */
export class MemoryModelProviderChannels {
  static readonly requires = [] as const;
  static readonly binds = { traces: TraceApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof MemoryModelProviderChannels.binds>;
  }): ModelProviderChannels {
    return {
      connectionPing: MemoryModelProviderConnectionPingChannel.create(),
      codexGatewayPing: MemoryModelProviderCodexGatewayPingChannel.create(),
      spans: bound.traces,
    };
  }
}
