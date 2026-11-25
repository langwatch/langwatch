import {
  type OrganizationMfaRequirementMail,
  OrganizationMfaRequirementMailChannel,
} from "../organization-mfa-requirement-mail.channel.ts";

/** Records each requirement mail it is handed and sends nothing; a repeated key is one mail. */
export class MemoryOrganizationMfaRequirementMailChannel extends OrganizationMfaRequirementMailChannel {
  static create(): MemoryOrganizationMfaRequirementMailChannel {
    return new MemoryOrganizationMfaRequirementMailChannel();
  }

  readonly sent: OrganizationMfaRequirementMail[] = [];

  private constructor() {
    super();
  }

  async sendRequirementChanged(input: OrganizationMfaRequirementMail): Promise<void> {
    const key = input.idempotencyKey;
    if (key !== undefined && this.sent.some((mail) => mail.idempotencyKey === key)) return;
    this.sent.push(input);
  }
}
