/** A pull request Langy opened, and the conversation, project and person it was opened for. */
export type LangyPullRequestLink = {
  organizationId: string;
  projectId: string;
  conversationId: string;
  userId: string;
  repositoryFullName: string;
  prNumber: number;
  linkedAt: number;
};

/** One pull request on one repository; the repository name is matched without case. */
export type LangyPullRequestKey = { repositoryFullName: string; prNumber: number };

/**
 * Which conversation opened each pull request, and the automatic follow-ups CI has started for
 * it since the person last spoke. Short-lived by design: a link lapses a month after it was last
 * written. Spec: modules/langy/specs/langy-ci-follow-up.feature.
 */
export abstract class LangyPullRequestLinkRepository {
  /** Remembers the link; linking the same pull request again keeps its follow-up count. */
  abstract link(link: LangyPullRequestLink): Promise<void>;

  /** Every conversation that linked the pull request: one in practice, empty when none did. */
  abstract findLinks(key: LangyPullRequestKey): Promise<LangyPullRequestLink[]>;

  /** True for the first claim of a commit; a second claim of the same commit answers false. */
  abstract claimWake(key: LangyPullRequestKey & { headSha: string }): Promise<boolean>;

  /** Gives a claim back, so a delivery retried later may wake Langy for the commit. */
  abstract releaseWake(key: LangyPullRequestKey & { headSha: string }): Promise<void>;

  /** Automatic follow-ups in a row for the pull request; zero when none. */
  abstract countFollowUps(key: LangyPullRequestKey): Promise<number>;

  /** Counts one follow-up and remembers its turn as automatic; answers the new count. */
  abstract recordFollowUp(
    key: LangyPullRequestKey & { conversationId: string; turnId: string },
  ): Promise<number>;

  abstract isFollowUpTurn(input: { conversationId: string; turnId: string }): Promise<boolean>;

  /** Starts the count again for every pull request the conversation linked. */
  abstract resetFollowUps(input: { conversationId: string }): Promise<void>;
}

/** A month: a pull request quiet for longer than that no longer wakes Langy. */
export const LANGY_PULL_REQUEST_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
