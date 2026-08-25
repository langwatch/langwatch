/**
 * Data-access layer for the pull requests discovered through the
 * organization's GitHub connection (`GithubPullRequest`) and the per-branch
 * bookkeeping behind the lookup (`GithubBranchPullRequestCheck`).
 *
 * The mapping, status and usage services are the only callers; no transport
 * layer touches Prisma for this feature. Repository methods use findAll /
 * findBy naming; services expose getAll / getBy.
 *
 * `repositoryFullName` is stored and matched LOWERCASED, because a session reports
 * whatever casing the developer's remote had, and the same repository must not
 * map twice. Normalisation happens at this boundary so no caller can forget it.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/** A stored pull-request snapshot. Times are Dates; `null` means "not yet". */
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
  prCreatedAt: Date;
  prClosedAt: Date | null;
  prMergedAt: Date | null;
  /**
   * GitHub's own `updated_at` for the snapshot in this row. Null for a row
   * written before the column existed, which reads as "unknown" and accepts
   * the next write.
   */
  prUpdatedAt: Date | null;
  mappedAt: Date;
  lastCheckedAt: Date;
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
  prCreatedAt: Date;
  prClosedAt: Date | null;
  prMergedAt: Date | null;
  /** When GitHub last changed this snapshot. The write's ordering key. */
  prUpdatedAt: Date;
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
  prClosedAt: Date | null;
  prMergedAt: Date | null;
  /** When GitHub last changed this snapshot. The write's ordering key. */
  prUpdatedAt: Date;
}

/** One branch's lookup bookkeeping. */
export interface GithubBranchCheckRow {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  lastCheckedAt: Date;
  prCount: number;
  notFoundAt: Date | null;
  recheckAfter: Date | null;
  attempts: number;
  lastRequestedAt: Date;
}

export interface UpsertGithubBranchCheckInput {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  lastCheckedAt: Date;
  prCount: number;
  notFoundAt: Date | null;
  recheckAfter: Date | null;
  attempts: number;
  /**
   * When demand for this branch was last recorded, or null to keep whatever is
   * stored.
   *
   * The sweep passes null. It selects branches by this column, so writing it
   * from inside the sweep renews the signal the sweep reads and no branch ever
   * leaves it: an unmapped branch would be asked about once a day for as long
   * as the connection existed.
   */
  lastRequestedAt: Date | null;
}

export abstract class GithubPullRequestsRepository {
  /**
   * Idempotent write of a mapping run's pull requests, by the unique key, and
   * ONLY when the incoming snapshot is at least as fresh as the stored one.
   *
   * Both writers into this table can arrive late. GitHub permits out-of-order
   * webhook delivery, so a delayed `opened` or `edited` can land after `closed`
   * was applied, and a slow REST listing can answer after a webhook already
   * stored a newer state. Written last-write-wins, either one reopens a merged
   * pull request and clears `prClosedAt` and `prMergedAt` — the two columns
   * session-to-pull-request attribution reads to decide which sessions belong
   * to which pull request — and regresses the title the page shows.
   *
   * `prUpdatedAt` orders the writes. A strictly older snapshot is skipped
   * silently; an equal one still writes, so a redelivery stays idempotent
   * rather than becoming a no-op that depends on delivery order.
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
  abstract tryFindByNumber(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null>;

  /**
   * Refresh the snapshot columns a live status read found to have drifted.
   * A no-op when the row is gone; a live read must never resurrect a mapping
   * the mapping run has not made.
   *
   * Guarded by `prUpdatedAt` exactly as `upsertPullRequests` is: this read runs
   * while a page is open, so its answer can be overtaken by a webhook before
   * the write lands.
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
   * Take the right to ask GitHub about one branch, atomically. `true` means
   * this caller holds it; `false` means the stored bookkeeping already answers
   * the question, or another caller is holding it right now.
   *
   * ONE statement, deliberately. Reading the row and then writing it is two,
   * and two concurrent sessions on one branch — the workload agent worktrees
   * produce — both read "not yet asked" before either writes, so both call
   * GitHub. An upsert whose UPDATE carries the claimability predicate cannot
   * split that way: the loser blocks on the unique index, re-evaluates against
   * the winner's row and matches nothing.
   *
   * The claim arms `recheckAfter` as a short lease, which is the same column
   * the backoff uses. That is not an overload of its meaning — both say "do not
   * ask again before this instant" — and the answer overwrites it: a found
   * branch clears it, an empty one replaces it with the real backoff, and only
   * a caller that crashed mid-lookup leaves the lease to expire on its own.
   */
  abstract claimBranchLookup(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    now: Date;
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
    lastRequestedAt: Date;
    staleBefore: Date;
  }): Promise<void>;

  /**
   * Pull a branch's next question forward to `dueAt`, and put its attempt count
   * back to zero, for a branch fresh session activity says is still being
   * worked on.
   *
   * Only ever brings it forward: a row already due at or before `dueAt` is left
   * alone, so this cannot push a question further away, and a branch that has
   * already mapped (`recheckAfter` is null) is not touched at all. That bound is
   * what makes it safe to call on every fold: several agent worktrees folding
   * on one branch within a minute all land on the same due date.
   */
  abstract bringBranchRecheckForward(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    dueAt: Date;
  }): Promise<void>;

  /**
   * The branches the background sweep should ask GitHub about again: mapped to
   * nothing, past their backoff, and still being asked about by a reader within
   * the last week.
   *
   * This is the ONE deliberately cross-organization read in the feature. Every
   * other query names its organization; this one cannot, because the sweep's
   * whole job is to walk every tenant's due branches on a timer with no
   * request context to scope it. It is admitted by a bound in
   * `dbOrganizationIdProtection.ts` matched to this exact predicate and to
   * `findMany` alone, in the same shape the platform's expired-key sweep is
   * admitted, and it selects bookkeeping columns only: a repository name, a
   * branch name and the timestamps, never a title, a body or a diff.
   */
  abstract findRecheckDue(params: {
    now: Date;
    /** How long since a reader last asked before a branch stops being swept. */
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]>;

  /**
   * Delete the branch bookkeeping past the activity horizon.
   *
   * Bookkeeping ONLY. The pull requests a branch resolved to are kept for good:
   * they are a record of work that was done, they are bounded by the number of
   * pull requests the organization actually opened, and the Pull Requests page
   * is mostly a place to look back at merged work. Deleting them with the
   * bookkeeping emptied that page of every pull request whose branch had been
   * quiet for a week.
   *
   * Bounded by the SAME horizon the sweep uses, deliberately rather than by a
   * retention knob of its own: a branch with no session demand for a week has
   * already dropped out of the sweep, so the feature has already stopped
   * maintaining it. Keeping the row after that is keeping a row that is never
   * read and never refreshed, at one row per agent branch per repository, which
   * is the shape that turns into millions a year.
   *
   * Self-healing, which is what makes the horizon safe to be this short. A
   * session folding on the branch again re-maps it from GitHub and writes the
   * bookkeeping back.
   *
   * Cross-tenant by nature, like the sweep it follows: system-owned
   * maintenance, so it takes the raw-SQL opt-out the platform's other retention
   * sweeps take.
   */
  abstract deleteStaleBefore(params: { before: Date }): Promise<{
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
  async tryFindByNumber(): Promise<GithubPullRequestRow | null> {
    return null;
  }
  async refreshSnapshot(): Promise<void> {}
  async tryFindBranchCheck(): Promise<GithubBranchCheckRow | null> {
    return null;
  }
  async upsertBranchCheck(): Promise<void> {}
  async claimBranchLookup(): Promise<boolean> {
    return false;
  }
  async touchBranchCheckRequestedAt(): Promise<void> {}
  async bringBranchRecheckForward(): Promise<void> {}
  async findRecheckDue(): Promise<GithubBranchCheckRow[]> {
    return [];
  }
  async deleteStaleBefore(): Promise<{ branchChecks: number }> {
    return { branchChecks: 0 };
  }
}
