import { MemoryUsageLimitEmailChannel } from "./memory/memory.usage-limit-email.channel.ts";

/**
 * The tiers behind `UsageLimitEmailChannel`.
 *
 * Plain object rather than `defineChannels({ live, memory })` from
 * `@langwatch/eventing`: that helper is still landing (ADR-144's channel
 * layer). This is the same shape `defineChannels` will take, so wiring it
 * through later is a one-line swap, not a redesign.
 *
 * There is no live tier in this package: the mail is rendered and sent by the
 * composing process's mailer, so a process without one binds this twin.
 */
export const usageLimitEmailChannels = {
  memory: MemoryUsageLimitEmailChannel,
};
