import { sendOrganizationMfaRequirementEmail, type MailSender } from "@langwatch/mail";

import {
  type OrganizationMfaRequirementMail,
  OrganizationMfaRequirementMailChannel,
} from "../organization-mfa-requirement-mail.channel.ts";

/** Main's requirement mail over the process's mail member; mail off skips it with one line. */
export class SesOrganizationMfaRequirementMailChannel extends OrganizationMfaRequirementMailChannel {
  static create(input: { mailer: MailSender }): SesOrganizationMfaRequirementMailChannel {
    return new SesOrganizationMfaRequirementMailChannel(input.mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  sendRequirementChanged(input: OrganizationMfaRequirementMail): Promise<void> {
    return sendOrganizationMfaRequirementEmail({ ...input, mailer: this.mailer });
  }
}
