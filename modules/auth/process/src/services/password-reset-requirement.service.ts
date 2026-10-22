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
  /** Matched users whose browser sessions were ended; zero on a dry run. */
  sessionsRevokedFor: number;
  /** Named addresses with no account, or whose account holds no password. */
  notMarkedEmails: string[];
};

const BATCH_SIZE = 500;
/** Users whose sessions are ended at once, so a large run does not flood Postgres and Redis. */
const REVOKE_CONCURRENCY = 10;

type PasswordHolders = Pick<UserApi, "findPasswordHolders" | "markPasswordResetRequired">;
type BrowserSessions = Pick<AuthApi, "revokeAllBrowserSessions">;

/**
 * Marks passwords as no longer trusted and ends the holders' browser sessions, so the next
 * sign-in needs a new password (modules/auth/specs/forced-password-reset.feature).
 * Idempotent: a re-run marks nobody twice, and ending sessions again is harmless.
 */
export class PasswordResetRequirementService {
  private constructor(
    private readonly users: PasswordHolders,
    private readonly sessions: BrowserSessions,
  ) {}

  static create({
    users,
    sessions,
  }: {
    users: PasswordHolders;
    sessions: BrowserSessions;
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
    if (!dryRun) {
      for (let start = 0; start < unmarked.length; start += BATCH_SIZE) {
        const userIds = unmarked.slice(start, start + BATCH_SIZE).map((holder) => holder.id);
        newlyMarked += (await this.users.markPasswordResetRequired({ userIds })).marked;
      }
      // Marked first, so no password sign-in can open a session after its old ones end.
      for (let start = 0; start < holders.length; start += REVOKE_CONCURRENCY) {
        const batch = holders.slice(start, start + REVOKE_CONCURRENCY);
        await Promise.all(
          batch.map((holder) => this.sessions.revokeAllBrowserSessions({ userId: holder.id })),
        );
        sessionsRevokedFor += batch.length;
      }
    }

    return {
      mode: dryRun ? "dry-run" : "execute",
      matched: holders.length,
      newlyMarked,
      alreadyMarked: holders.length - unmarked.length,
      sessionsRevokedFor,
      notMarkedEmails: (emails ?? []).filter((email) => !held.has(email)),
    };
  }
}
