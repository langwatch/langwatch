import { MemoryAddressConfirmationMailChannel } from "./memory/memory.address-confirmation-mail.channel.ts";
import { SesAddressConfirmationMailChannel } from "./ses/ses.address-confirmation-mail.channel.ts";

export const addressConfirmationMailChannels = {
  ses: SesAddressConfirmationMailChannel,
  memory: MemoryAddressConfirmationMailChannel,
};
