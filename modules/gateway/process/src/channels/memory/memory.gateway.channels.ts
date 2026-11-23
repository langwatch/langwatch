import type { GatewayChannels } from "../gateway.channels.ts";
import { MemoryElevenLabsConversationChannel } from "./memory.elevenlabs-conversation.channel.ts";
import { MemoryGatewayUserDirectoryChannel } from "./memory.gateway-user-directory.channel.ts";

/** Realtime conversations and accounts are answered in-process from what a test seeds. */
export class MemoryGatewayChannels {
  static readonly requires = [] as const;

  static create(): GatewayChannels & { readonly users: MemoryGatewayUserDirectoryChannel } {
    return {
      conversations: MemoryElevenLabsConversationChannel.create(),
      users: MemoryGatewayUserDirectoryChannel.create(),
    };
  }
}
