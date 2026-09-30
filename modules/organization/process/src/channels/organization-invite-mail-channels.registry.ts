import { MemoryOrganizationInviteMailChannel } from "./memory/memory.organization-invite-mail.channel.ts";
import { SesOrganizationInviteMailChannel } from "./ses/ses.organization-invite-mail.channel.ts";

export const organizationInviteMailChannels = {
  ses: SesOrganizationInviteMailChannel,
  memory: MemoryOrganizationInviteMailChannel,
};
