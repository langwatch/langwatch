/**
 * Every message a person-shaped surface sends, over the ONE outbound mail graph this process
 * composed.
 *
 * The twin of {@link ApiComposedPasswordResetMail}: a whole send that `@langwatch/mail` owns
 * end to end, and the deployment's public host arrives with the message rather than being read
 * out of the template package. Without it the sign-up confirmation link, the budget-increase
 * request and all six join-request notifications were composed by nobody, so a deployment with
 * a configured mail gateway still sent none of them.
 */
import {
  sendBudgetIncreaseRequestEmail,
  sendDomainAutoJoinedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestArrivedEmail,
  sendJoinRequestExpiredEmail,
  sendJoinRequestRejectedEmail,
  sendJoinRequestReminderEmail,
  sendSignUpVerificationEmail,
} from "@langwatch/mail";
import type { ApiMailComposition } from "./api-mail.composition";
import { ApiPersonMailPort } from "./api-person-mail.port";

export class ApiComposedPersonMail extends ApiPersonMailPort {
  static create(mail: ApiMailComposition): ApiComposedPersonMail {
    return new ApiComposedPersonMail(mail);
  }

  private constructor(private readonly mail: ApiMailComposition) {
    super();
  }

  /** Where an administrator acts on a join request, and where a new member lands. */
  private get membersSettingsUrl(): string {
    return `${this.mail.baseHost}/settings/members`;
  }

  async sendSignUpVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<unknown> {
    return sendSignUpVerificationEmail({
      mailer: this.mail.delivery,
      email: input.email,
      verificationUrl: input.verificationUrl,
    });
  }

  async sendBudgetIncreaseRequest(input: {
    to: string;
    requesterEmail: string;
    requesterName?: string;
    organizationName: string;
    budgetsUrl: string;
    scope: string;
    scopeId: string;
    limitUsd: string;
    spentUsd: string;
    period?: string;
    message?: string;
  }): Promise<unknown> {
    return sendBudgetIncreaseRequestEmail({ ...input, mailer: this.mail.delivery });
  }

  async sendRequestArrived(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    domain: string;
  }): Promise<unknown> {
    return sendJoinRequestArrivedEmail({
      mailer: this.mail.delivery,
      ...input,
      membersSettingsUrl: this.membersSettingsUrl,
    });
  }

  async sendRequestStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<unknown> {
    return sendJoinRequestReminderEmail({
      mailer: this.mail.delivery,
      ...input,
      membersSettingsUrl: this.membersSettingsUrl,
    });
  }

  async sendRequestApproved(input: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<unknown> {
    return sendJoinRequestApprovedEmail({
      mailer: this.mail.delivery,
      ...input,
      organizationUrl: this.mail.baseHost,
    });
  }

  async sendRequestRejected(input: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<unknown> {
    return sendJoinRequestRejectedEmail({ mailer: this.mail.delivery, ...input });
  }

  async sendRequestExpired(input: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<unknown> {
    return sendJoinRequestExpiredEmail({ mailer: this.mail.delivery, ...input });
  }

  async sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
  }): Promise<unknown> {
    return sendDomainAutoJoinedEmail({
      mailer: this.mail.delivery,
      ...input,
      membersSettingsUrl: this.membersSettingsUrl,
    });
  }
}
