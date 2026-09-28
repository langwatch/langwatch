import { MemoryPasswordResetMailChannel } from "./memory/memory.password-reset-mail.channel.ts";
import { SesPasswordResetMailChannel } from "./ses/ses.password-reset-mail.channel.ts";

export const passwordResetMailChannels = {
  ses: SesPasswordResetMailChannel,
  memory: MemoryPasswordResetMailChannel,
};
