import type {
  GithubPullRequestRef,
  GithubPullRequestStatus,
} from "../services/github-pull-request-status.service.ts";

/**
 * The live pull-request status rows, cached for a minute so a board that
 * re-reads the same references does not ask GitHub again. A miss is not an
 * error: the read falls through to the provider.
 */
export abstract class GithubPullRequestStatusCacheRepository {
  abstract findStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestStatus | null>;

  abstract storeStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
    status: GithubPullRequestStatus;
  }): Promise<void>;
}
