import { nowInstant, type Instant } from "@langwatch/time";

import {
  GithubPullRequestsRepository,
  type GithubBranchCheckRow,
  type GithubPullRequestRow,
  type RefreshGithubPullRequestSnapshotInput,
  type UpsertGithubBranchCheckInput,
  type UpsertGithubPullRequestInput,
} from "../github-pull-requests.repository.ts";
import { MemoryGithubDatabase } from "./memory.github.database.ts";

/**
 * The pull-request snapshots and the branch bookkeeping in memory, with the
 * same freshness guard, the same claim predicate and the same orderings the
 * Prisma twin runs in SQL.
 */
export class MemoryGithubPullRequestsRepository extends GithubPullRequestsRepository {
  #database: MemoryGithubDatabase;

  private constructor(database: MemoryGithubDatabase) {
    super();
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryGithubDatabase }>,
  ): MemoryGithubPullRequestsRepository {
    return new MemoryGithubPullRequestsRepository(input.memory);
  }

  async upsertPullRequests({
    pullRequests,
  }: {
    pullRequests: readonly UpsertGithubPullRequestInput[];
  }): Promise<void> {
    for (const pullRequest of pullRequests) this.writeSnapshot(pullRequest);
  }

  /** Accepted only when the incoming snapshot is at least as fresh as the stored one. */
  private writeSnapshot(pullRequest: UpsertGithubPullRequestInput): void {
    const key = MemoryGithubDatabase.pullRequestKey(pullRequest);
    const stored = this.#database.pullRequests.get(key);
    if (stored && !isFresh(stored.prUpdatedAt, pullRequest.prUpdatedAt)) return;

    const now = nowInstant();
    this.#database.pullRequests.set(key, {
      organizationId: pullRequest.organizationId,
      repositoryHost: MemoryGithubDatabase.normalizeHost(pullRequest.repositoryHost),
      repositoryFullName: MemoryGithubDatabase.normalizeFullName(pullRequest.repositoryFullName),
      prNumber: pullRequest.prNumber,
      headBranch: pullRequest.headBranch,
      htmlUrl: pullRequest.htmlUrl,
      title: pullRequest.title,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      authorLogin: pullRequest.authorLogin,
      prCreatedAt: pullRequest.prCreatedAt,
      prClosedAt: pullRequest.prClosedAt,
      prMergedAt: pullRequest.prMergedAt,
      prUpdatedAt: pullRequest.prUpdatedAt,
      mappedAt: stored?.mappedAt ?? now,
      lastCheckedAt: now,
    });
  }

  async findAllByBranches({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranches,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<GithubPullRequestRow[]> {
    if (headBranches.length === 0) return [];

    return this.findAllByBranchKeys({
      organizationId,
      keys: headBranches.map((headBranch) => ({
        repositoryHost,
        repositoryFullName,
        headBranch,
      })),
    });
  }

  async findAllByBranchKeys({
    organizationId,
    keys,
  }: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<GithubPullRequestRow[]> {
    if (keys.length === 0) return [];

    const wanted = new Set(
      keys.map((key) =>
        [
          MemoryGithubDatabase.normalizeHost(key.repositoryHost),
          MemoryGithubDatabase.normalizeFullName(key.repositoryFullName),
          key.headBranch,
        ].join(" "),
      ),
    );

    return [...this.#database.pullRequests.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          wanted.has([row.repositoryHost, row.repositoryFullName, row.headBranch].join(" ")),
      )
      .sort(
        (left, right) => left.prCreatedAt.epochMilliseconds - right.prCreatedAt.epochMilliseconds,
      );
  }

  async tryFindByNumber(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null> {
    return this.#database.pullRequests.get(MemoryGithubDatabase.pullRequestKey(params)) ?? null;
  }

  async refreshSnapshot(input: RefreshGithubPullRequestSnapshotInput): Promise<void> {
    const key = MemoryGithubDatabase.pullRequestKey(input);
    const stored = this.#database.pullRequests.get(key);
    if (!stored || !isFresh(stored.prUpdatedAt, input.prUpdatedAt)) return;

    this.#database.pullRequests.set(key, {
      ...stored,
      title: input.title,
      state: input.state,
      isDraft: input.isDraft,
      prClosedAt: input.prClosedAt,
      prMergedAt: input.prMergedAt,
      prUpdatedAt: input.prUpdatedAt,
      lastCheckedAt: nowInstant(),
    });
  }

  async tryFindBranchCheck(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
  }): Promise<GithubBranchCheckRow | null> {
    return this.#database.branchChecks.get(MemoryGithubDatabase.branchCheckKey(params)) ?? null;
  }

  async upsertBranchCheck(input: UpsertGithubBranchCheckInput): Promise<void> {
    const key = MemoryGithubDatabase.branchCheckKey(input);
    const stored = this.#database.branchChecks.get(key);
    const bookkeeping = {
      lastCheckedAt: input.lastCheckedAt,
      prCount: input.prCount,
      notFoundAt: input.notFoundAt,
      recheckAfter: input.recheckAfter,
      attempts: input.attempts,
    };

    if (!stored) {
      this.#database.branchChecks.set(key, {
        organizationId: input.organizationId,
        repositoryHost: MemoryGithubDatabase.normalizeHost(input.repositoryHost),
        repositoryFullName: MemoryGithubDatabase.normalizeFullName(input.repositoryFullName),
        headBranch: input.headBranch,
        ...bookkeeping,
        lastRequestedAt: input.lastRequestedAt ?? input.lastCheckedAt,
      });
      return;
    }

    this.#database.branchChecks.set(key, {
      ...stored,
      ...bookkeeping,
      lastRequestedAt: input.lastRequestedAt ?? stored.lastRequestedAt,
    });
  }

  async claimBranchLookup(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    now: Instant;
    freshMappingMs: number;
    leaseMs: number;
    shouldRecordDemand: boolean;
  }): Promise<boolean> {
    const key = MemoryGithubDatabase.branchCheckKey(params);
    const leaseUntil = params.now.add({ milliseconds: params.leaseMs });
    const stored = this.#database.branchChecks.get(key);

    if (!stored) {
      this.#database.branchChecks.set(key, {
        organizationId: params.organizationId,
        repositoryHost: MemoryGithubDatabase.normalizeHost(params.repositoryHost),
        repositoryFullName: MemoryGithubDatabase.normalizeFullName(params.repositoryFullName),
        headBranch: params.headBranch,
        lastCheckedAt: params.now,
        prCount: 0,
        notFoundAt: null,
        recheckAfter: leaseUntil,
        attempts: 0,
        lastRequestedAt: params.now,
      });
      return true;
    }

    const freshSince = params.now.subtract({ milliseconds: params.freshMappingMs });
    const leaseElapsed =
      stored.recheckAfter === null ||
      stored.recheckAfter.epochMilliseconds <= params.now.epochMilliseconds;
    const mappingIsFresh =
      stored.prCount > 0 && stored.lastCheckedAt.epochMilliseconds > freshSince.epochMilliseconds;
    if (!leaseElapsed || mappingIsFresh) return false;

    this.#database.branchChecks.set(key, {
      ...stored,
      recheckAfter: leaseUntil,
      lastRequestedAt: params.shouldRecordDemand ? params.now : stored.lastRequestedAt,
    });
    return true;
  }

  async touchBranchCheckRequestedAt(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastRequestedAt: Instant;
    staleBefore: Instant;
  }): Promise<void> {
    const key = MemoryGithubDatabase.branchCheckKey(params);
    const stored = this.#database.branchChecks.get(key);
    if (!stored) return;
    if (stored.lastRequestedAt.epochMilliseconds > params.staleBefore.epochMilliseconds) return;

    this.#database.branchChecks.set(key, { ...stored, lastRequestedAt: params.lastRequestedAt });
  }

  async bringBranchRecheckForward(params: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    dueAt: Instant;
  }): Promise<void> {
    const key = MemoryGithubDatabase.branchCheckKey(params);
    const stored = this.#database.branchChecks.get(key);
    if (!stored || stored.recheckAfter === null) return;
    if (stored.recheckAfter.epochMilliseconds <= params.dueAt.epochMilliseconds) return;

    this.#database.branchChecks.set(key, {
      ...stored,
      recheckAfter: params.dueAt,
      attempts: 0,
    });
  }

  async findRecheckDue(params: {
    now: Instant;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    const activeSince = params.now.subtract({ milliseconds: params.activeWithinMs });

    return [...this.#database.branchChecks.values()]
      .filter(
        (row) =>
          row.notFoundAt !== null &&
          row.recheckAfter !== null &&
          row.recheckAfter.epochMilliseconds <= params.now.epochMilliseconds &&
          row.lastRequestedAt.epochMilliseconds > activeSince.epochMilliseconds,
      )
      .sort(
        (left, right) =>
          (left.recheckAfter?.epochMilliseconds ?? 0) -
          (right.recheckAfter?.epochMilliseconds ?? 0),
      )
      .slice(0, params.limit);
  }

  async deleteStaleBefore({ before }: { before: Instant }): Promise<{ branchChecks: number }> {
    let branchChecks = 0;
    for (const [key, row] of this.#database.branchChecks) {
      if (row.lastRequestedAt.epochMilliseconds >= before.epochMilliseconds) continue;
      this.#database.branchChecks.delete(key);
      branchChecks += 1;
    }

    return { branchChecks };
  }
}

/**
 * The stored row has no source timestamp, or one at or before the incoming
 * snapshot's. `lte` because GitHub redelivers and two events can share one
 * `updated_at`.
 */
function isFresh(stored: Instant | null, incoming: Instant): boolean {
  return stored === null || stored.epochMilliseconds <= incoming.epochMilliseconds;
}
