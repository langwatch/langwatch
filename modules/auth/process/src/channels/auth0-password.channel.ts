import type { AuthFederatedPasswordOutcome } from "@langwatch/auth-contract";
import { Secret } from "@langwatch/secrets";

/** The Auth0 Management app's secret; absent, the login app's stands in, as main's did. */
export const auth0ManagementSecret = Secret.load("AUTH0_MGMT_CLIENT_SECRET", { optional: true });

/** One password change for an identity in the deployment's Auth0 database connection. */
export type Auth0PasswordChangeRequest = {
  email: string;
  auth0UserId: string;
  currentPassword: string;
  newPassword: string;
};

/** What the tenant answers: every outcome but the two decided before it is asked. */
export type Auth0PasswordChangeOutcome = Exclude<
  AuthFederatedPasswordOutcome,
  { outcome: "no_federated_account" } | { outcome: "no_address_on_record" }
>;

/** The Auth0 tenant's password change. The memory tier answers what it was told to. */
export abstract class Auth0PasswordChannel {
  abstract changePassword(input: Auth0PasswordChangeRequest): Promise<Auth0PasswordChangeOutcome>;
}
