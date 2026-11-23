import type { ElevenLabsConversationChannel } from "./elevenlabs-conversation.channel.ts";
import type { GatewayUserDirectoryChannel } from "./gateway-user-directory.channel.ts";

/** Every channel gateway holds, as the container hands them to the module class. */
export interface GatewayChannels {
  readonly conversations: ElevenLabsConversationChannel;
  readonly users: GatewayUserDirectoryChannel;
}
