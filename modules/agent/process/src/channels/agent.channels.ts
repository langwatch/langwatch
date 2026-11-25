import type { ConnectedAgentRelayChannel } from "./connected-agent-relay.channel.ts";

/** Every channel agent holds, as the container hands them to the module class. */
export interface AgentChannels {
  readonly relay: ConnectedAgentRelayChannel;
}
