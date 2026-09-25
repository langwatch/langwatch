import { HttpLitellmModelChannel } from "./http/http.litellm-model.channel.ts";
import { MemoryLitellmModelChannel } from "./memory/memory.litellm-model.channel.ts";

/** The two tiers behind `LitellmModelChannel`. */
export const litellmModelChannels = {
  live: HttpLitellmModelChannel,
  memory: MemoryLitellmModelChannel,
};
