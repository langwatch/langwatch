import { HttpElevenLabsConversationChannel } from "./http/http.elevenlabs-conversation.channel.ts";
import { MemoryElevenLabsConversationChannel } from "./memory/memory.elevenlabs-conversation.channel.ts";

/** The two tiers behind `ElevenLabsConversationChannel`. */
export const elevenLabsConversationChannels = {
  live: HttpElevenLabsConversationChannel,
  memory: MemoryElevenLabsConversationChannel,
};
