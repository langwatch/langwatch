/**
 * Every message a person-shaped surface sends, as it asks for one.
 */
import { JoinRequestNotificationMailPort } from "@langwatch/identity-server";

export abstract class ApiPersonMailPort extends JoinRequestNotificationMailPort {
  /** The sign-up confirmation link. Asking twice sends twice. */
  abstract sendSignUpVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<unknown>;

  /** A member asking their administrator for more budget. */
  abstract sendBudgetIncreaseRequest(input: {
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
