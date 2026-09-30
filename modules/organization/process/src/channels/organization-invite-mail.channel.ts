import type { OrganizationInviteMail } from "../app/organization.members.ts";

/**
 * The two messages an invitation puts in somebody's inbox. Who is invited and what the accept URL
 * is are the invitation service's decisions; the envelope and template are the mail
 * composition's. The memory tier records and sends nothing.
 */
export abstract class OrganizationInviteMailChannel implements OrganizationInviteMail {
  abstract sendInvite(input: Parameters<OrganizationInviteMail["sendInvite"]>[0]): Promise<void>;
  abstract sendInviteReRequest(
    input: Parameters<OrganizationInviteMail["sendInviteReRequest"]>[0],
  ): Promise<void>;
}
