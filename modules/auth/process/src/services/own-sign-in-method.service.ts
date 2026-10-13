/**
 * Removing one of the caller's own sign-in methods through Better Auth's account storage, so the
 * identity branch detaches it where sign-in reads (ADR-116), never only the legacy row.
 * Spec: modules/auth/specs/account-lifecycle.feature.
 */
import type { IdentityApi } from "@langwatch/identity-contract";
import {
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
  type UnlinkUserAccountInput,
} from "@langwatch/user-contract";

import type { CredentialAccounts } from "./own-password.service.ts";

type SignInMethodAccounts = Pick<CredentialAccounts, "listAccountIds" | "deleteAccount">;

export class OwnSignInMethodService {
  private constructor(
    private readonly credentials: SignInMethodAccounts,
    private readonly identity: Pick<IdentityApi, "resolveEmail">,
  ) {}

  static create({
    credentials,
    identity,
  }: {
    credentials: SignInMethodAccounts;
    identity: Pick<IdentityApi, "resolveEmail">;
  }): OwnSignInMethodService {
    return new OwnSignInMethodService(credentials, identity);
  }

  /**
   * A legacy account refuses its last account row, as main's does. A moved account asks identity's
   * detach guard, which the account delete runs, so a passkey or an address counts as a way back.
   */
  async unlink(input: UnlinkUserAccountInput): Promise<void> {
    const [accountIds, email] = await Promise.all([
      this.credentials.listAccountIds({ userId: input.userId }),
      this.identity.resolveEmail({ userId: input.userId }),
    ]);
    const onIdentity = email.kind === "resolved";

    if (!onIdentity && accountIds.length <= 1) throw new UserLastAuthenticationMethodError();
    if (!accountIds.includes(input.accountId)) {
      throw new UserLinkedAccountNotFoundError(input.accountId);
    }

    await this.credentials.deleteAccount({ accountId: input.accountId });
  }
}
