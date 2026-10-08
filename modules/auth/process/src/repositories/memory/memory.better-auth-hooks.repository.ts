import { fromDate, nowInstant, toDate } from "@langwatch/time";
import { UserNotFoundError } from "@langwatch/user-contract";

import {
  BetterAuthHooksRepository,
  type BetterAuthHookUser,
  type FederatedAccountRow,
} from "../better-auth-hooks.repository.ts";
import type {
  MemoryAccountRow,
  MemoryAuthDatabase,
  MemoryUserRow,
} from "./memory.auth.database.ts";

/** The memory twin of the hooks' `User` and `Account` reads, over the adapter's own tables. */
export class MemoryBetterAuthHooksRepository extends BetterAuthHooksRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryBetterAuthHooksRepository {
    return new MemoryBetterAuthHooksRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  private users(): MemoryUserRow[] {
    return this.memory.db.User as MemoryUserRow[];
  }

  private accounts(): MemoryAccountRow[] {
    return this.memory.db.Account as MemoryAccountRow[];
  }

  private requireUser(userId: string): MemoryUserRow {
    const user = this.users().find((row) => row.id === userId);
    if (user === undefined) throw new UserNotFoundError(userId);
    return user;
  }

  async getUserForHooks({ userId }: { userId: string }): Promise<BetterAuthHookUser> {
    const user = this.requireUser(userId);
    return {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      emailVerified: user.emailVerified ?? false,
      deactivatedAt: user.deactivatedAt ? fromDate(user.deactivatedAt) : null,
      pendingSsoSetup: user.pendingSsoSetup ?? false,
      signupConfirmationPending: user.signupConfirmationPending ?? false,
    };
  }

  async countAccountsForUser({ userId }: { userId: string }): Promise<number> {
    return this.accounts().filter((row) => row.userId === userId).length;
  }

  async findFederatedAccountsForUser({
    userId,
  }: {
    userId: string;
  }): Promise<{ providerId: string; accountId: string }[]> {
    return (await this.findFederatedAccountsForUsers({ userIds: [userId] })).map(
      ({ providerId, accountId }) => ({ providerId, accountId }),
    );
  }

  async findFederatedAccountsForUsers({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<FederatedAccountRow[]> {
    return this.accounts()
      .filter((row) => userIds.includes(row.userId) && row.provider !== "credential")
      .map((row) => ({
        rowId: row.id,
        userId: row.userId,
        providerId: row.provider,
        accountId: row.providerAccountId,
      }));
  }

  async deleteAccounts({ accountRowIds }: { accountRowIds: readonly string[] }): Promise<number> {
    const before = this.accounts().length;
    this.memory.db.Account = this.accounts().filter((row) => !accountRowIds.includes(row.id));
    return before - this.memory.db.Account.length;
  }

  async flagPendingSsoSetup({ userId }: { userId: string }): Promise<void> {
    this.requireUser(userId).pendingSsoSetup = true;
  }

  async reconcileSsoAccounts({
    userId,
    providerId,
    accountId,
  }: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void> {
    const user = this.requireUser(userId);
    this.memory.db.Account = this.accounts().filter(
      (row) =>
        row.userId !== userId ||
        row.provider === "credential" ||
        (row.provider === providerId && row.providerAccountId === accountId),
    );
    user.pendingSsoSetup = false;
  }

  async recordLastLogin({ userId }: { userId: string }): Promise<void> {
    this.requireUser(userId).lastLoginAt = toDate(nowInstant());
  }
}
