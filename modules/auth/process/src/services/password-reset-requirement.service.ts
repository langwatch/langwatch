import type { AuthApi } from "@langwatch/auth-contract";
import type { UserApi } from "@langwatch/user-contract";

/** Whom to mark: every user holding a credential password, or the holders at these addresses. */
export type PasswordResetSelector =
  | { kind: "all_credential_users" }
  | { kind: "emails"; emails: readonly string[] };

export type PasswordResetRequirementReport = {
  mode: "dry-run" | "execute";
  /** Users holding a password that the selector reached. */
  matched: number;
  /** Marked by this run; on a dry run, how many would be. */
  newlyMarked: number;
  /** Already marked by an earlier run; their mark keeps its time. */
  alreadyMarked: number;
  /** Matched users whose browser sessions and CLI logins were ended; zero on a dry run. */
  sessionsRevokedFor: number;
  /** CLI tokens revoked across those users; zero on a dry run. */
  cliTokensRevoked: number;
  /** Named addresses with no account, or whose account holds no password. */
  notMarkedEmails: string[];
};

const BATCH_SIZE = 500;
/** Users whose sessions are ended at once, so a large run does not flood Postgres and Redis. */
const REVOKE_CONCURRENCY = 10;

type PasswordHolders = Pick<UserApi, "findPasswordHolders" | "markPasswordResetRequired">;
type Sessions = Pick<AuthApi, "revokeAllBrowserSessions" | "revokeCliTokens">;

/**
 * Marks passwords as no longer trusted and ends the holders' browser sessions and CLI logins,
 * so the next sign-in needs a new password (modules/auth/specs/forced-password-reset.feature).
 * Idempotent: a re-run marks no user twice, and ending sessions again is harmless.
 */
export class PasswordResetRequirementService {
  private constructor(
    private readonly users: PasswordHolders,
    private readonly sessions: Sessions,
  ) {}

  static create({
    users,
    sessions,
  }: {
    users: PasswordHolders;
    sessions: Sessions;
  }): PasswordResetRequirementService {
    return new PasswordResetRequirementService(users, sessions);
  }

  async markForReset({
    selector,
    dryRun,
  }: {
    selector: PasswordResetSelector;
    dryRun: boolean;
  }): Promise<PasswordResetRequirementReport> {
    const emails =
      selector.kind === "emails"
        ? [...new Set(selector.emails.map((email) => email.trim().toLowerCase()))]
        : null;
    const holders = await this.users.findPasswordHolders({ emails });
    const unmarked = holders.filter((holder) => !holder.markedForReset);
    const held = new Set(holders.map((holder) => holder.email?.toLowerCase()));

    let newlyMarked = dryRun ? unmarked.length : 0;
    let sessionsRevokedFor = 0;
    let cliTokensRevoked = 0;
    if (!dryRun) {
      for (let start = 0; start < unmarked.length; start += BATCH_SIZE) {
        const userIds = unmarked.slice(start, start + BATCH_SIZE).map((holder) => holder.id);
        newlyMarked += (await this.users.markPasswordResetRequired({ userIds })).marked;
      }
      // Marked first, so no password sign-in can open a session after its old ones end.
      for (let start = 0; start < holders.length; start += REVOKE_CONCURRENCY) {
        const batch = holders.slice(start, start + REVOKE_CONCURRENCY);
        const revoked = await Promise.all(
          batch.map(async ({ id: userId }) => {
            await this.sessions.revokeAllBrowserSessions({ userId });
            return (await this.sessions.revokeCliTokens({ userId })).revokedCount;
          }),
        );
        sessionsRevokedFor += batch.length;
        cliTokensRevoked += revoked.reduce((sum, count) => sum + count, 0);
      }
    }

    return {
      mode: dryRun ? "dry-run" : "execute",
      matched: holders.length,
      newlyMarked,
      alreadyMarked: holders.length - unmarked.length,
      sessionsRevokedFor,
      cliTokensRevoked,
      notMarkedEmails: (emails ?? []).filter((email) => !held.has(email)),
    };
  }
}
