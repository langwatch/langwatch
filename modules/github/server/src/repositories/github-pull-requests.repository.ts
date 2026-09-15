/**
 * Data-access layer for pull requests and branch bookkeeping, called by
 * mapping/status/usage services. Normalizes repository names to lowercase.
 */

import type { Instant } from "@langwatch/time";

/** A stored pull-request snapshot. Times are instants; `null` means "not yet". */
export interface GithubPullRequestRow {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  prNumber: number;
  htmlUrl: string;
  title: string;
  /** GitHub's own state string: "open" or "closed". */
  state: string;
  isDraft: boolean;
  authorLogin: string | null;
  prCreatedAt: Instant;
  prClosedAt: Instant | null;
  prMergedAt: Instant | null;
  /**
   * GitHub's own `updated_at` for the snapshot in this row. Null for a row
   * written before the column existed, which reads as "unknown" and accepts
   * the next write.
   */
  prUpdatedAt: Instant | null;
  mappedAt: Instant;
  lastCheckedAt: Instant;
}

/** Everything a mapping run knows about one pull request. */
export interface UpsertGithubPullRequestInput {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  prNumber: number;
  htmlUrl: string;
  title: string;
  state: string;
  isDraft: boolean;
  authorLogin: string | null;
  prCreatedAt: Instant;
  prClosedAt: Instant | null;
  prMergedAt: Instant | null;
  /** When GitHub last changed this snapshot. The write's ordering key. */
  prUpdatedAt: Instant;
}

/** The columns a live read refreshes when the stored snapshot has drifted. */
export interface RefreshGithubPullRequestSnapshotInput {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  title: string;
  state: string;
  isDraft: boolean;
  prClosedAt: Instant | null;
  prMergedAt: Instant | null;
  /** When GitHub last changed this snapshot. The write's ordering key. */
  prUpdatedAt: Instant;
}

/** One branch's lookup bookkeeping. */
export interface GithubBranchCheckRow {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  lastCheckedAt: Instant;
  prCount: number;
  notFoundAt: Instant | null;
  recheckAfter: Instant | null;
  attempts: number;
  lastRequestedAt: Instant;
}

export interface UpsertGithubBranchCheckInput {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  lastCheckedAt: Instant;
  prCount: number;
  notFoundAt: Instant | null;
  recheckAfter: Instant | null;
  attempts: number;
  /**
   * When demand was last recorded; null to keep stored value. The sweep passes
   * null to avoid renewing the signal it reads.
   */
  lastRequestedAt: Instant | null;
}

export abstract class GithubPullRequestsRepository {
  /**
   * Idempotent upsert by unique key, ordered by `prUpdatedAt` freshness. Both
   * GitHub webhooks and REST requests can arrive out-of-order and late.
   */
  abstract upsertPullRequests(params: {
    pullRequests: readonly UpsertGithubPullRequestInput[];
  }): Promise<void>;

  /** Every stored pull request whose head is one of `headBranches`. */
  abstract findAllByBranches(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<GithubPullRequestRow[]>;

  /**
   * The same read across several repositories at once, for a page of sessions
   * that may name a different repository on every row. One query, because a
   * lookup per row is a lookup per row.
   */
  abstract findAllByBranchKeys(params: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<GithubPullRequestRow[]>;

  /** One pull request by its number within a repository, or null. */
  abstract findByNumber(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null>;

  /**
   * Refresh snapshot columns that drifted. Guarded by `prUpdatedAt` since
   * webhook may overtake this read's answer before write lands.
   */
  abstract refreshSnapshot(input: RefreshGithubPullRequestSnapshotInput): Promise<void>;

  abstract tryFindBranchCheck(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
  }): Promise<GithubBranchCheckRow | null>;

  abstract upsertBranchCheck(input: UpsertGithubBranchCheckInput): Promise<void>;

  /**
   * Atomic claim to ask GitHub about one branch. One statement prevents
   * concurrent sessions from both calling GitHub for the same branch.
   */
  abstract claimBranchLookup(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    now: Instant;
    /** How long a branch that already resolved to a pull request is trusted. */
    freshMappingMs: number;
    /** How long the claim holds if the lookup never records an answer. */
    leaseMs: number;
    /**
     * Whether this claim is demand for the branch, and so refreshes
     * `lastRequestedAt`. The sweep passes false: the branch is on its due list
     * because of demand already recorded, and renewing it here would keep the
     * branch on that list for good.
     */
    shouldRecordDemand: boolean;
  }): Promise<boolean>;

  /**
   * Record demand for a branch whose lookup another caller is already holding,
   * so losing the claim still keeps the branch inside the sweep's activity
   * window, but only for a row whose `lastRequestedAt` is at or before
   * `staleBefore`, so a burst of folds on one branch writes once.
   */
  abstract touchBranchCheckRequestedAt(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastRequestedAt: Instant;
    staleBefore: Instant;
  }): Promise<void>;

  /**
   * Pull forward a branch's next question and reset attempt count when fresh
   * session activity indicates it's still being worked on.
   */
  abstract bringBranchRecheckForward(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    dueAt: Instant;
  }): Promise<void>;

  /**
   * Branches the sweep should re-ask about: mapped to nothing, past backoff,
   * still being asked by a reader within the last week.
   */
  abstract findRecheckDue(params: {
    now: Instant;
    /** How long since a reader last asked before a branch stops being swept. */
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]>;

  /**
   * Delete stale branch bookkeeping past activity horizon. Keeps pull request
   * records forever; they are bounded work history.
   */
  abstract deleteStaleBefore(params: { before: Instant }): Promise<{
    branchChecks: number;
  }>;
}

export class NullGithubPullRequestsRepository extends GithubPullRequestsRepository {
  async upsertPullRequests(): Promise<void> {}
  async findAllByBranches(): Promise<GithubPullRequestRow[]> {
    return [];
  }
  async findAllByBranchKeys(): Promise<GithubPullRequestRow[]> {
    return [];
  }
  async findByNumber(_params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null> {
    return null;
  }
  async refreshSnapshot(_input: RefreshGithubPullRequestSnapshotInput): Promise<void> {}
  async tryFindBranchCheck(): Promise<GithubBranchCheckRow | null> {
    return null;
  }
  async upsertBranchCheck(): Promise<void> {}
  async claimBranchLookup(): Promise<boolean> {
    return false;
  }
  async touchBranchCheckRequestedAt(): Promise<void> {}
  async bringBranchRecheckForward(): Promise<void> {}
  async findRecheckDue(_params: {
    now: Instant;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    return [];
  }
  async deleteStaleBefore(_params: { before: Instant }): Promise<{ branchChecks: number }> {
    return { branchChecks: 0 };
  }
}
