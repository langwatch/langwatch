import {
  type OrganizationMfaRequirementMail,
  OrganizationMfaRequirementMailChannel,
} from "../organization-mfa-requirement-mail.channel.ts";

/** Records each requirement mail it is handed and sends nothing. */
export class MemoryOrganizationMfaRequirementMailChannel extends OrganizationMfaRequirementMailChannel {
  static create(): MemoryOrganizationMfaRequirementMailChannel {
    return new MemoryOrganizationMfaRequirementMailChannel();
  }

  readonly sent: OrganizationMfaRequirementMail[] = [];

  private constructor() {
    super();
  }

  async sendRequirementChanged(input: OrganizationMfaRequirementMail): Promise<void> {
    this.sent.push(input);
  }
}
