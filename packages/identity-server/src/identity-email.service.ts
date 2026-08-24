import { primaryEmailOf } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { IdentityHeadsRepository } from "./identity-heads.repository";
import type { IdentityUserGate } from "./identity-user-gate";

const logger = createLogger("langwatch:identity:email");

/**
 * The READ fork for `User.email` (ADR-101 §5; D03 generalizes it to the
 * whole router).
 *
 * `User.email` is a legacy column that answers a question identity now owns:
 * which address is this person's. For a user whose backfill is `finalized`
 * the identifiers are the truth and the column is a stale copy, so this
 * service answers from the projection. For everyone else the column still
 * IS the truth, so the caller keeps whatever it already read.
 *
 * Every answer is a fallback, never a failure: an ungated user, a user with
 * no live email identifier, an unreadable projection — all return null, and
 * `null` means "use the legacy column". The one thing this must never do is
 * make a request fail, because `getServerAuthSession` runs on every request
 * that touches a session.
 *
 * Same gate as the writes, deliberately (`IdentityUserGate`): a user whose
 * ceremonies emit events is exactly the user whose identifiers are proven
 * against their legacy rows, so reads and writes flip together.
 */
export class IdentityEmailService {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly isOnIdentity: IdentityUserGate,
  ) {}

  /**
   * The user's email according to their identifiers — PRIMARY, else the
   * most recently VERIFIED — or null to keep the legacy column's answer.
   */
  async resolveEmail({ userId }: { userId: string }): Promise<string | null> {
    try {
      if (!(await this.isOnIdentity({ userId }))) return null;
      const heads = await this.heads.findHeads({ userId });
      return primaryEmailOf({ heads });
    } catch (error) {
      // A read fork that can break sign-in is worse than a stale email.
      logger.warn(
        { userId, error },
        "could not resolve the identifier email; falling back to the legacy User.email column",
      );
      return null;
    }
  }
}
