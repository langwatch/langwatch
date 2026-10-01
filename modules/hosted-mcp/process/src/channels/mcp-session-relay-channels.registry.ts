import { MemoryMcpSessionRelayChannel } from "./memory/memory.mcp-session-relay.channel.ts";
import { RedisMcpSessionRelayChannel } from "./redis/redis.mcp-session-relay.channel.ts";

/** The two tiers behind `McpSessionRelayChannel`. */
export const mcpSessionRelayChannels = {
  live: RedisMcpSessionRelayChannel,
  memory: MemoryMcpSessionRelayChannel,
};
