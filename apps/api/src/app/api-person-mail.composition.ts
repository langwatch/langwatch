/**
 * Every message a person-shaped surface sends, over this process's one
 * outbound mail graph. Twin of {@link ApiComposedPasswordResetMail}: the
 * public host arrives with the message rather than being read from the template.
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
import type { ApiMailComposition } from "./api-mail.composition.ts";
import { ApiPersonMail } from "./api-person-mail.port.ts";

export class ApiComposedPersonMail extends ApiPersonMail {
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

  /** The first steps a new member is shown, on this deployment. */
  private get onboardingUrl(): string {
    return `${this.mail.baseHost}/onboarding`;
  }

  async sendSignUpVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<unknown> {
    return sendSignUpVerificationEmail({
      mailer: this.mail.delivery,
      email: input.email,
      verificationUrl: input.verificationUrl,
      // No organization exists yet at this point in sign-up, so nothing here
      // knows why they came and the block shows its default steps.
      firstSteps: {},
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
    approvedFromDomainCount?: number;
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
    intent?: "AGENT_GOVERNANCE" | "LLM_OPS";
  }): Promise<unknown> {
    const { intent, ...rest } = input;

    return sendJoinRequestApprovedEmail({
      mailer: this.mail.delivery,
      ...rest,
      organizationUrl: this.mail.baseHost,
      onboardingUrl: this.onboardingUrl,
      firstSteps: { ...(intent ? { intent } : {}) },
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
    personalProjectUrl?: string;
  }): Promise<unknown> {
    return sendJoinRequestExpiredEmail({ mailer: this.mail.delivery, ...input });
  }

  async sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
    seats?: { used: number; ceiling: number };
  }): Promise<unknown> {
    return sendDomainAutoJoinedEmail({
      mailer: this.mail.delivery,
      ...input,
      membersSettingsUrl: this.membersSettingsUrl,
    });
  }
}
