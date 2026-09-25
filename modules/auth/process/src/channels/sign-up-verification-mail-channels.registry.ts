import { MemorySignUpVerificationMailChannel } from "./memory/memory.sign-up-verification-mail.channel.ts";
import { SesSignUpVerificationMailChannel } from "./ses/ses.sign-up-verification-mail.channel.ts";

export const signUpVerificationMailChannels = {
  ses: SesSignUpVerificationMailChannel,
  memory: MemorySignUpVerificationMailChannel,
};
