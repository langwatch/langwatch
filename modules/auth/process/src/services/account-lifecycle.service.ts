/**
 * The account changes that must end credentials: user writes, auth ends what outlives the write.
 * Spec: modules/auth/specs/account-lifecycle.feature.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import {
  UserAccountAccessDeniedError,
  UserPlatformOperatorEmailLockedError,
  type UpdateUserEmailInput,
  type UserApi,
  type UserCaller,
  type UserLifecycleChangeInput,
  type UserProfile,
} from "@langwatch/user-contract";

type AccountWrites = Pick<
  UserApi,
  "findById" | "updateEmail" | "deactivate" | "recordDeactivated" | "isOperator"
>;

type CredentialRevokes = Pick<AuthApi, "revokeAllBrowserSessions" | "revokeCliTokens">;

export class AccountLifecycleService {
  private constructor(
    private readonly users: AccountWrites,
    private readonly credentials: CredentialRevokes,
    private readonly operatorAddressesFixed: boolean,
  ) {}

  static create({
    users,
    credentials,
    operatorAddressesFixed = true,
  }: {
    users: AccountWrites;
    credentials: CredentialRevokes;
    /** Where only staff may operate (the hosted service), an operator's address is fixed. */
    operatorAddressesFixed?: boolean;
  }): AccountLifecycleService {
    return new AccountLifecycleService(users, credentials, operatorAddressesFixed);
  }

  /** Write, revoke, fact: a refused write revokes nothing; a failed fact leaves access ended. */
  async deactivate(input: UserLifecycleChangeInput): Promise<UserProfile> {
    const user = await this.users.deactivate(input);
    await this.credentials.revokeAllBrowserSessions({ userId: input.id });
    await this.credentials.revokeCliTokens({ userId: input.id });
    await this.users.recordDeactivated(input);

    return user;
  }

  /** Retiring someone else may revoke an operator, so it is never done while impersonating. */
  async deactivateAsCaller({
    userId,
    caller,
  }: {
    userId: string;
    caller: UserCaller;
  }): Promise<void> {
    const isOthers = userId !== caller.id;
    if (
      isOthers &&
      (caller.impersonated || !(await this.users.isOperator({ userId: caller.operatorId })))
    ) {
      throw new UserAccountAccessDeniedError();
    }

    await this.deactivate({ id: userId, actor: { type: "user", id: caller.operatorId } });
  }

  /**
   * Sessions cache the address (invite accept compares it), so a real change ends them all. Where
   * only staff operate, an operator's address never changes: the grant checked it against the rule.
   */
  async changeEmail(input: UpdateUserEmailInput): Promise<UserProfile> {
    const before = await this.users.findById({ id: input.id });
    const changes = (before?.email ?? "").toLowerCase() !== input.email.trim().toLowerCase();
    if (
      changes &&
      this.operatorAddressesFixed &&
      (await this.users.isOperator({ userId: input.id }))
    ) {
      throw new UserPlatformOperatorEmailLockedError(input.id);
    }
    const updated = await this.users.updateEmail(input);
    if (changes) await this.credentials.revokeAllBrowserSessions({ userId: input.id });

    return updated;
  }
}
