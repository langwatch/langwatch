/**
 * The account changes that must end credentials: user writes, auth ends what outlives the write.
 * Spec: modules/auth/specs/account-lifecycle.feature.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import {
  UserAccountAccessDeniedError,
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
  ) {}

  static create({
    users,
    credentials,
  }: {
    users: AccountWrites;
    credentials: CredentialRevokes;
  }): AccountLifecycleService {
    return new AccountLifecycleService(users, credentials);
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

  /** Sessions cache the address (invite accept compares it), so a real change ends them all. */
  async changeEmail(input: UpdateUserEmailInput): Promise<UserProfile> {
    const before = await this.users.findById({ id: input.id });
    const updated = await this.users.updateEmail(input);
    if ((before?.email ?? "").toLowerCase() !== (updated.email ?? "").toLowerCase()) {
      await this.credentials.revokeAllBrowserSessions({ userId: input.id });
    }

    return updated;
  }
}
