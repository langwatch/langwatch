/**
 * Every message a person-shaped surface sends, as it asks for one.
 *
 * A PORT rather than the mail gateway itself, and that is the load-bearing
 * part: rendering a LangWatch message is react-email, and a value-import chain
 * from a backend process to React is what `frontend-boundary.unit.test.ts`
 * exists to stop. So the process states what it wants said, to whom, with the
 * links already built, and the tier that owns the gateway renders it.
 *
 * One port for three features because it is one gateway. The sign-up
 * confirmation is the auth feature's, the budget request the user feature's and
 * the six join-request notices the organization feature's — but a deployment
 * either composed a gateway or it did not, and splitting the declaration would
 * let it hold two.
 *
 * `@langwatch/mail` holds the templates each of these renders.
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
