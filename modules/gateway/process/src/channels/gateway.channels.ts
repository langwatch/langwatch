import type { ElevenLabsConversationChannel } from "./elevenlabs-conversation.channel.ts";

/** Every channel gateway holds, as the container hands them to the module class. */
export interface GatewayChannels {
  readonly conversations: ElevenLabsConversationChannel;
}
