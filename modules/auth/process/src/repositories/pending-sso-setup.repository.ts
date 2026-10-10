import type { OAuthAccountLike } from "@langwatch/auth-contract";

/** A person still flagged `pendingSsoSetup`, with every federated account they hold. */
export type PendingSsoSetupCandidate = {
  id: string;
  email: string | null;
  accounts: OAuthAccountLike[];
};

/**
 * The `User.pendingSsoSetup` flag the sign-in hook sets, read in id order so a
 * cleanup can page it, and cleared once it no longer reflects reality.
 */
export interface PendingSsoSetupRepository {
  /** The next `take` flagged people after `afterId`, ascending by id. */
  findPendingPage(input: {
    afterId: string | undefined;
    take: number;
  }): Promise<PendingSsoSetupCandidate[]>;
  clearPendingSsoSetup(input: { userId: string }): Promise<void>;
}
