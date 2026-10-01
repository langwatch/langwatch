import type {
  AuthFederatedPasswordChange,
  AuthFederatedPasswordOutcome,
} from "@langwatch/auth-contract";

import type { Auth0PasswordChannel } from "../channels/auth0-password.channel.ts";
import type { BetterAuthHooksRepository } from "../repositories/better-auth-hooks.repository.ts";

export interface FederatedPasswordServiceDeps {
  accounts: Pick<BetterAuthHooksRepository, "findFederatedAccountsForUser">;
  auth0: Auth0PasswordChannel;
}

/** The Auth0 database connection's identities, and only them: social ones belong upstream. */
function isAuth0DatabaseAccount(account: { providerId: string; accountId: string }): boolean {
  return account.providerId === "auth0" && account.accountId.startsWith("auth0|");
}

/**
 * Changing a password the Auth0 tenant holds rather than one of this
 * deployment's own rows: main's `CredentialAccountService.changeFederatedPassword`.
 * Ending the other sessions stays with the caller, which knows which one to keep.
 */
export class FederatedPasswordService {
  static create(deps: FederatedPasswordServiceDeps): FederatedPasswordService {
    return new FederatedPasswordService(deps);
  }

  private constructor(private readonly deps: FederatedPasswordServiceDeps) {}

  async changePassword(input: AuthFederatedPasswordChange): Promise<AuthFederatedPasswordOutcome> {
    const accounts = await this.deps.accounts.findFederatedAccountsForUser({
      userId: input.userId,
    });
    const account = accounts.find(isAuth0DatabaseAccount);
    if (!account) return { outcome: "no_federated_account" };
    if (!input.email) return { outcome: "no_address_on_record" };

    return this.deps.auth0.changePassword({
      email: input.email,
      auth0UserId: account.accountId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
  }
}
