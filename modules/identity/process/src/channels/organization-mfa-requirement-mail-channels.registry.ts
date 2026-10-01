import { MemoryOrganizationMfaRequirementMailChannel } from "./memory/memory.organization-mfa-requirement-mail.channel.ts";
import { SesOrganizationMfaRequirementMailChannel } from "./ses/ses.organization-mfa-requirement-mail.channel.ts";

export const organizationMfaRequirementMailChannels = {
  ses: SesOrganizationMfaRequirementMailChannel,
  memory: MemoryOrganizationMfaRequirementMailChannel,
};
