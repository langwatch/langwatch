import { MemoryUsageLimitEmailChannel } from "./memory/memory.usage-limit-email.channel.ts";

/**
 * Channels for UsageLimitEmailChannel. Wiring through defineChannels()
 * later is a one-line swap.
 */
export const usageLimitEmailChannels = {
  memory: MemoryUsageLimitEmailChannel,
};
