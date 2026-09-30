import type { OrganizationInviteMail } from "../../app/organization.members.ts";
import { OrganizationInviteMailChannel } from "../organization-invite-mail.channel.ts";

type Sent<Name extends keyof OrganizationInviteMail> = Parameters<OrganizationInviteMail[Name]>[0];

/** Records each invitation mail it is handed and sends nothing. */
export class MemoryOrganizationInviteMailChannel extends OrganizationInviteMailChannel {
  static create(): MemoryOrganizationInviteMailChannel {
    return new MemoryOrganizationInviteMailChannel();
  }

  readonly invites: Sent<"sendInvite">[] = [];
  readonly reRequests: Sent<"sendInviteReRequest">[] = [];

  private constructor() {
    super();
  }

  async sendInvite(input: Sent<"sendInvite">): Promise<void> {
    this.invites.push(input);
  }

  async sendInviteReRequest(input: Sent<"sendInviteReRequest">): Promise<void> {
    this.reRequests.push(input);
  }
}
