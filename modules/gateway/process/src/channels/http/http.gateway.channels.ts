import type { GatewayChannels } from "../gateway.channels.ts";
import { HttpElevenLabsConversationChannel } from "./http.elevenlabs-conversation.channel.ts";

/** Realtime conversations are read from ElevenLabs behind the egress fence. */
export class HttpGatewayChannels {
  static readonly requires = [] as const;

  static create(): GatewayChannels {
    return { conversations: HttpElevenLabsConversationChannel.create() };
  }
}
