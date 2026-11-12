import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { LangyConversationPullRequestsData } from "../rules/langy-ci-follow-up.rules.ts";

/** A conversation that opened a pull request, and its CI follow-ups since the person spoke. */
export type LangyConversationPullRequestMatch = {
  projectId: string;
  conversationId: string;
  followUpsInARow: number;
};

/**
 * The fold's rows, one per conversation: the store the projection writes, and the lookup CI
 * uses to find the conversation that opened a pull request.
 * Spec: modules/langy/specs/langy-ci-follow-up.feature.
 */
export abstract class LangyConversationPullRequestsRepository implements StateProjectionStore<LangyConversationPullRequestsData> {
  abstract get(
    conversationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<LangyConversationPullRequestsData>>;

  abstract store(
    projection: StoredProjection<LangyConversationPullRequestsData>,
    context: ProjectionStoreContext,
  ): Promise<void>;

  /** Every conversation in these projects that opened the pull request; empty when none did. */
  abstract findByPullRequest(input: {
    projectIds: readonly string[];
    repositoryFullName: string;
    prNumber: number;
  }): Promise<LangyConversationPullRequestMatch[]>;
}
