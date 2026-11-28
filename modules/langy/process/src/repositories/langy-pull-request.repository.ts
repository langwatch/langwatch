import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";

import type { LangyPullRequestsOpenedRecord } from "../rules/langy-ci-follow-up.rules.ts";

/** A pull request Langy opened: where it was opened and for whom. */
export type LangyOpenedPullRequest = {
  projectId: string;
  conversationId: string;
  userId: string;
  openedAt: number;
};

/**
 * One row per pull request Langy opened, keyed by repository and number: the store the map
 * projection appends to, CI's lookup of the conversation to wake, and the daily cap's count.
 * Spec: modules/langy/specs/langy-ci-follow-up.feature, specs/langy/langy-github-prs.feature.
 */
export abstract class LangyPullRequestRepository implements AppendStore<LangyPullRequestsOpenedRecord> {
  /**
   * Stores each pull request the answer opened, owned by the conversation's owner; a pull request
   * already stored keeps its row. Throws a retryable error until the conversation is folded.
   */
  abstract append(
    record: LangyPullRequestsOpenedRecord,
    context: ProjectionStoreContext,
  ): Promise<void>;

  /** The pull request in one of these projects, as a list of at most one; empty when none. */
  abstract findByPullRequest(input: {
    projectIds: readonly string[];
    repositoryFullName: string;
    prNumber: number;
  }): Promise<LangyOpenedPullRequest[]>;

  /** How many pull requests Langy opened for the person, in any project, since the instant. */
  abstract countOpenedSince(input: { userId: string; since: number }): Promise<number>;
}
