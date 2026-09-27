import { HttpOpenAiChatChannel } from "./http/http.openai-chat.channel.ts";
import { MemoryOpenAiChatChannel } from "./memory/memory.openai-chat.channel.ts";

/** Where the hotel bot's model calls go. */
export const openAiChatChannels = {
  live: HttpOpenAiChatChannel,
  memory: MemoryOpenAiChatChannel,
};
