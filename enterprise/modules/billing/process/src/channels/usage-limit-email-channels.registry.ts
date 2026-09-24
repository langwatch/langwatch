import { MemoryUsageLimitEmailChannel } from "./memory/memory.usage-limit-email.channel.ts";
import { SesUsageLimitEmailChannel } from "./ses/ses.usage-limit-email.channel.ts";

export const usageLimitEmailChannels = {
  ses: SesUsageLimitEmailChannel,
  memory: MemoryUsageLimitEmailChannel,
};
