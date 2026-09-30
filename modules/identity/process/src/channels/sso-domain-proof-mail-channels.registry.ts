import { MemorySsoDomainProofMailChannel } from "./memory/memory.sso-domain-proof-mail.channel.ts";
import { SesSsoDomainProofMailChannel } from "./ses/ses.sso-domain-proof-mail.channel.ts";

export const ssoDomainProofMailChannels = {
  ses: SesSsoDomainProofMailChannel,
  memory: MemorySsoDomainProofMailChannel,
};
