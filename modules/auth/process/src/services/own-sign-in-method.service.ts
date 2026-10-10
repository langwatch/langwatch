/**
 * Removing one of the caller's own sign-in methods through Better Auth's account storage, so the
 * identity branch detaches it where sign-in reads (ADR-116), never only the legacy row.
 * Spec: modules/auth/specs/account-lifecycle.feature.
 */
import {
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
  type UnlinkUserAccountInput,
} from "@langwatch/user-contract";

import type { CredentialAccounts } from "./own-password.service.ts";

export class OwnSignInMethodService {
  private constructor(
    private readonly credentials: Pick<CredentialAccounts, "listAccountIds" | "deleteAccount">,
  ) {}

  static create({
    credentials,
  }: {
    credentials: Pick<CredentialAccounts, "listAccountIds" | "deleteAccount">;
  }): OwnSignInMethodService {
    return new OwnSignInMethodService(credentials);
  }

  /** Refuses the last way in; the identity branch's detach guard still answers for the rest. */
  async unlink(input: UnlinkUserAccountInput): Promise<void> {
    const accountIds = await this.credentials.listAccountIds({ userId: input.userId });

    if (accountIds.length <= 1) throw new UserLastAuthenticationMethodError();
    if (!accountIds.includes(input.accountId)) {
      throw new UserLinkedAccountNotFoundError(input.accountId);
    }

    await this.credentials.deleteAccount({ accountId: input.accountId });
  }
}
