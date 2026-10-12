import type { Instant } from "@langwatch/time";

/** A user's SSO/session-relevant fields, as read by the Better Auth hooks. */
export type BetterAuthHookUser = {
  id: string;
  email: string | null;
  /** What an admitted arrival is announced under; absent on older rows. */
  name: string | null;
  /** Whether the account's own address was ever confirmed. */
  emailVerified: boolean;
  deactivatedAt: Instant | null;
  pendingSsoSetup: boolean;
  /** A password sign-up still awaiting its emailed proof: no session until it lands. */
  signupConfirmationPending: boolean;
};

/** One federated account row, with the id a retirement deletes it by. */
export type FederatedAccountRow = {
  rowId: string;
  userId: string;
  providerId: string;
  accountId: string;
};

/**
 * Private persistence boundary for the Better Auth database hooks — ADR-027
 * SSO gate, ADR-101 identifier reconciliation, ADR-116 SSO auto-join. One
 * boundary since every hook reads/writes the same rows (User, Account).
 */
export abstract class BetterAuthHooksRepository {
  /** Throws `UserNotFoundError`. */
  abstract getUserForHooks(input: { userId: string }): Promise<BetterAuthHookUser>;
  abstract countAccountsForUser(input: { userId: string }): Promise<number>;
  abstract countPasskeysForUser(input: { userId: string }): Promise<number>;
  /**
   * The federated accounts this person holds, credential rows excluded. Read
   * for a peer that decides something about them and owns no `Account` row
   * of its own.
   */
  abstract findFederatedAccountsForUser(input: {
    userId: string;
  }): Promise<{ providerId: string; accountId: string }[]>;
  /**
   * The federated accounts these people hold, credential rows excluded, each
   * with the row's own id: what a retiring connection's sweep decides over.
   */
  abstract findFederatedAccountsForUsers(input: {
    userIds: readonly string[];
  }): Promise<FederatedAccountRow[]>;
  /** Deletes these account rows, answering how many actually went. */
  abstract deleteAccounts(input: { accountRowIds: readonly string[] }): Promise<number>;
  abstract flagPendingSsoSetup(input: { userId: string }): Promise<void>;
  /**
   * Atomically deletes every OAuth account row for the user EXCEPT the one
   * being linked/refreshed, and clears `pendingSsoSetup`.
   */
  abstract reconcileSsoAccounts(input: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void>;
  abstract recordLastLogin(input: { userId: string }): Promise<void>;
}
