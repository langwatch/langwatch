/**
 * Every message a person-shaped surface sends, as it asks for one.
 */
import { type JoinRequestNotificationMail } from "@langwatch/identity-server";

export interface ApiPersonMail extends JoinRequestNotificationMail {
  /** The sign-up confirmation link. Asking twice sends twice. */
  sendSignUpVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<unknown>;

  /** A member asking their administrator for more budget. */
  sendBudgetIncreaseRequest(input: {
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
  }): Promise<unknown>;
}
