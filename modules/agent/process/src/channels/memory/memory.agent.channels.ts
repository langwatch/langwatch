import type { AgentChannels } from "../agent.channels.ts";
import { MemoryConnectedAgentRelayChannel } from "./memory.connected-agent-relay.channel.ts";

/** The relay's messages heard inside one process. */
export class MemoryAgentChannels {
  static readonly requires = [] as const;

  static create(): AgentChannels {
    return { relay: MemoryConnectedAgentRelayChannel.create() };
  }
}
