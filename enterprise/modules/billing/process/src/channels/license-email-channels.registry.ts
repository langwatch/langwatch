import { MemoryLicenseEmailChannel } from "./memory/memory.license-email.channel.ts";
import { SesLicenseEmailChannel } from "./ses/ses.license-email.channel.ts";

export const licenseEmailChannels = {
  ses: SesLicenseEmailChannel,
  memory: MemoryLicenseEmailChannel,
};
