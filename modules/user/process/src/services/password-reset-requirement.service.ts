import { nowInstant, type Instant } from "@langwatch/time";

import type { UserRepository } from "../repositories/user.repository.ts";

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
  /** Named addresses with no account, or whose account holds no password. */
  notMarkedEmails: string[];
};

const BATCH_SIZE = 500;

/**
 * Marks passwords as no longer trusted, so the next password sign-in sends the person to reset it
 * (modules/auth/specs/forced-password-reset.feature). Idempotent: a re-run marks nobody twice.
 */
export class PasswordResetRequirementService {
  private constructor(
    private readonly users: Pick<
      UserRepository,
      "findPasswordHolders" | "markPasswordResetRequired"
    >,
    private readonly now: () => Instant,
  ) {}

  static create({
    users,
    now = nowInstant,
  }: {
    users: Pick<UserRepository, "findPasswordHolders" | "markPasswordResetRequired">;
    now?: () => Instant;
  }): PasswordResetRequirementService {
    return new PasswordResetRequirementService(users, now);
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
    const unmarked = holders.filter((holder) => holder.passwordResetRequiredAt === null);
    const held = new Set(holders.map((holder) => holder.email));

    let newlyMarked = dryRun ? unmarked.length : 0;
    if (!dryRun) {
      const at = this.now();
      for (let start = 0; start < unmarked.length; start += BATCH_SIZE) {
        const ids = unmarked.slice(start, start + BATCH_SIZE).map((holder) => holder.id);
        newlyMarked += await this.users.markPasswordResetRequired({ ids, at });
      }
    }

    return {
      mode: dryRun ? "dry-run" : "execute",
      matched: holders.length,
      newlyMarked,
      alreadyMarked: holders.length - unmarked.length,
      notMarkedEmails: (emails ?? []).filter((email) => !held.has(email)),
    };
  }
}
