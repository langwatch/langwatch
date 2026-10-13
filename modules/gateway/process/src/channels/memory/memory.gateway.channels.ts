import type { GatewayChannels } from "../gateway.channels.ts";
import { MemoryElevenLabsConversationChannel } from "./memory.elevenlabs-conversation.channel.ts";

/** Realtime conversations are answered in-process from the reports a test seeds. */
export class MemoryGatewayChannels {
  static readonly requires = [] as const;

  static create(): GatewayChannels {
    return { conversations: MemoryElevenLabsConversationChannel.create() };
  }
}
