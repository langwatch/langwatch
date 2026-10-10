/** A password change asked of the identity provider this deployment brokers through. */
export type AuthFederatedPasswordChange = Readonly<{
  userId: string;
  /** Null where the account carries no address to prove the current password with. */
  email: string | null;
  currentPassword: string;
  newPassword: string;
}>;

/** What became of a federated password change: main's `FederatedPasswordResult`, plus the
 *  tenant's own refusals. */
export type AuthFederatedPasswordOutcome =
  | { outcome: "changed" }
  /** The person holds no Auth0 database identity, the only one whose password moves. */
  | { outcome: "no_federated_account" }
  | { outcome: "no_address_on_record" }
  | { outcome: "wrong_password" }
  /** The tenant's own policy refused the new password; its wording. */
  | { outcome: "weak_password"; message: string }
  | { outcome: "insufficient_scope" }
  | { outcome: "password_grant_not_enabled" }
  /** This deployment names no Auth0 tenant with Management credentials. */
  | { outcome: "not_configured" }
  | { outcome: "failed" };
