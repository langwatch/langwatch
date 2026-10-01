import { HttpPostHogChannel } from "./http/http.posthog.channel.ts";
import { MemoryPostHogChannel } from "./memory/memory.posthog.channel.ts";

export const postHogChannels = {
  live: HttpPostHogChannel,
  memory: MemoryPostHogChannel,
};
