import type { GithubUsageCount } from "@langwatch/github-contract";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  GithubPullRequestsRepository,
  type GithubBranchCheckRow,
  type GithubPullRequestRow,
  type RefreshGithubPullRequestSnapshotInput,
  type UpsertGithubBranchCheckInput,
  type UpsertGithubPullRequestInput,
} from "../github-pull-requests.repository.ts";

type PullRequestRecord = {
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
  prUpdatedAt: Date | null;
  mappedAt: Date;
  lastCheckedAt: Date;
};

type BranchCheckRecord = {
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
};

/**
 * The client this repository reads through, named by the delegates it uses —
 * states which part of the typed `PrismaClient` linkage touches, so a wrong
 * caller is a type error at composition, not a `TypeError` on first query.
 */
export type PrismaGithubPullRequestsDatabase = Pick<
  PrismaClient,
  "githubPullRequest" | "githubBranchPullRequestCheck" | "$executeRaw"
>;

/** The ksuid kind a branch pull-request check row is minted under. */
const GITHUB_BRANCH_CHECK_KSUID_RESOURCE = "githubbranchcheck";

export class PrismaGithubPullRequestsRepository extends GithubPullRequestsRepository {
  static create(database: PrismaGithubPullRequestsDatabase): PrismaGithubPullRequestsRepository {
    return new PrismaGithubPullRequestsRepository(database);
  }

  private constructor(private readonly prisma: PrismaGithubPullRequestsDatabase) {
    super();
  }

  async countUsage({
    organizationIds,
    since,
  }: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<GithubUsageCount> {
    const scope = { organizationId: { in: [...organizationIds] } };
    const pullRequests = await this.prisma.githubPullRequest.count({
      where: since === undefined ? scope : { ...scope, prCreatedAt: { gte: new Date(since) } },
    });
    return { pullRequests };
  }

  async upsertPullRequests({
    pullRequests,
  }: {
    pullRequests: readonly UpsertGithubPullRequestInput[];
  }): Promise<void> {
    for (const pullRequest of pullRequests) {
      await this.writeSnapshot(pullRequest);
    }
  }

  /**
   * Upsert with freshness guard: guarded updateMany + create ensures only
   * fresher snapshots overwrite stored rows.
   */
  private async writeSnapshot(pullRequest: UpsertGithubPullRequestInput): Promise<void> {
    const key = {
      organizationId: pullRequest.organizationId,
      repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(pullRequest.repositoryHost),
      repositoryFullName: PrismaGithubPullRequestsRepository.normalizeFullName(
        pullRequest.repositoryFullName,
      ),
      prNumber: pullRequest.prNumber,
    };
    const snapshot = {
      headBranch: pullRequest.headBranch,
      htmlUrl: pullRequest.htmlUrl,
      title: pullRequest.title,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      authorLogin: pullRequest.authorLogin,
      prCreatedAt: toDate(pullRequest.prCreatedAt),
      prClosedAt: pullRequest.prClosedAt && toDate(pullRequest.prClosedAt),
      prMergedAt: pullRequest.prMergedAt && toDate(pullRequest.prMergedAt),
      prUpdatedAt: pullRequest.prUpdatedAt && toDate(pullRequest.prUpdatedAt),
      lastCheckedAt: new Date(),
    };
    const guard = PrismaGithubPullRequestsRepository.freshnessGuard(pullRequest.prUpdatedAt);

    const updated = await this.prisma.githubPullRequest.updateMany({
      where: { ...key, ...guard },
      data: snapshot,
    });
    if (updated.count > 0) {
      return;
    }

    try {
      await this.prisma.githubPullRequest.create({
        data: { ...key, ...snapshot },
      });
    } catch (error) {
      if (!PrismaGithubPullRequestsRepository.isUniqueViolation(error)) {
        throw error;
      }
      await this.prisma.githubPullRequest.updateMany({
        where: { ...key, ...guard },
        data: snapshot,
      });
    }
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
    if (headBranches.length === 0) {
      return [];
    }
    const records = await this.prisma.githubPullRequest.findMany({
      where: {
        organizationId,
        repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost),
        repositoryFullName:
          PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName),
        headBranch: { in: [...headBranches] },
      },
      orderBy: { prCreatedAt: "asc" },
    });
    return records.map((record) => PrismaGithubPullRequestsRepository.toPullRequestRow(record));
  }

  async findAllByBranchKeys({
    organizationId,
    keys,
  }: {
    organizationId: string;
    keys: readonly {
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }[];
  }): Promise<GithubPullRequestRow[]> {
    if (keys.length === 0) {
      return [];
    }
    const records = await this.prisma.githubPullRequest.findMany({
      where: {
        organizationId,
        OR: keys.map((key) => ({
          repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(key.repositoryHost),
          repositoryFullName: PrismaGithubPullRequestsRepository.normalizeFullName(
            key.repositoryFullName,
          ),
          headBranch: key.headBranch,
        })),
      },
      orderBy: { prCreatedAt: "asc" },
    });
    return records.map((record) => PrismaGithubPullRequestsRepository.toPullRequestRow(record));
  }

  async findByNumber({
    organizationId,
    repositoryHost,
    repositoryFullName,
    prNumber,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null> {
    const record = await this.prisma.githubPullRequest.findUnique({
      where: {
        organizationId_repositoryHost_repositoryFullName_prNumber: {
          organizationId,
          repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost),
          repositoryFullName:
            PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName),
          prNumber,
        },
      },
    });
    return record ? PrismaGithubPullRequestsRepository.toPullRequestRow(record) : null;
  }

  async refreshSnapshot(input: RefreshGithubPullRequestSnapshotInput): Promise<void> {
    await this.prisma.githubPullRequest.updateMany({
      where: {
        organizationId: input.organizationId,
        repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(input.repositoryHost),
        repositoryFullName: PrismaGithubPullRequestsRepository.normalizeFullName(
          input.repositoryFullName,
        ),
        prNumber: input.prNumber,
        // A live read is answered while a page is open, so a webhook can store
        // a newer snapshot between the read and this write.
        ...PrismaGithubPullRequestsRepository.freshnessGuard(input.prUpdatedAt),
      },
      data: {
        title: input.title,
        state: input.state,
        isDraft: input.isDraft,
        prClosedAt: input.prClosedAt && toDate(input.prClosedAt),
        prMergedAt: input.prMergedAt && toDate(input.prMergedAt),
        prUpdatedAt: toDate(input.prUpdatedAt),
        lastCheckedAt: new Date(),
      },
    });
  }

  async findBranchCheck({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
  }): Promise<GithubBranchCheckRow | null> {
    const record = await this.prisma.githubBranchPullRequestCheck.findUnique({
      where: {
        organizationId_repositoryHost_repositoryFullName_headBranch: {
          organizationId,
          repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost),
          repositoryFullName:
            PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName),
          headBranch,
        },
      },
    });
    return record ? PrismaGithubPullRequestsRepository.toBranchCheckRow(record) : null;
  }

  /**
   * Bookkeeping write where lastRequestedAt is optional: null keeps stored value.
   * Create falls back to lastCheckedAt when demand hasn't recorded one yet.
   */
  async upsertBranchCheck(input: UpsertGithubBranchCheckInput): Promise<void> {
    const repositoryFullName = PrismaGithubPullRequestsRepository.normalizeFullName(
      input.repositoryFullName,
    );
    const bookkeeping = {
      lastCheckedAt: toDate(input.lastCheckedAt),
      prCount: input.prCount,
      notFoundAt: input.notFoundAt && toDate(input.notFoundAt),
      recheckAfter: input.recheckAfter && toDate(input.recheckAfter),
      attempts: input.attempts,
    };
    await this.prisma.githubBranchPullRequestCheck.upsert({
      where: {
        organizationId_repositoryHost_repositoryFullName_headBranch: {
          organizationId: input.organizationId,
          repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(input.repositoryHost),
          repositoryFullName,
          headBranch: input.headBranch,
        },
      },
      create: {
        organizationId: input.organizationId,
        repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(input.repositoryHost),
        repositoryFullName,
        headBranch: input.headBranch,
        ...bookkeeping,
        lastRequestedAt: toDate(input.lastRequestedAt ?? input.lastCheckedAt),
      },
      update: input.lastRequestedAt
        ? { ...bookkeeping, lastRequestedAt: toDate(input.lastRequestedAt) }
        : bookkeeping,
    });
  }

  /**
   * Atomic claim via INSERT ... ON CONFLICT DO UPDATE WHERE. Raw SQL needed
   * because Prisma's upsert update is unconditional.
   */
  async claimBranchLookup({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
    now,
    freshMappingMs,
    leaseMs,
    shouldRecordDemand,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    now: Instant;
    freshMappingMs: number;
    leaseMs: number;
    shouldRecordDemand: boolean;
  }): Promise<boolean> {
    const fullName = PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName);
    const host = PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost);
    // Naive-UTC `::timestamp` literals: a raw JS Date binds as `timestamptz`
    // and the comparison then runs through the session timezone, which on a
    // developer's machine makes a fifteen-minute backoff look already elapsed
    // and lets every racer claim. See `toPgTimestampUtc`.
    const at = PrismaGithubPullRequestsRepository.toPgTimestampUtc(toDate(now));
    const leaseUntil = PrismaGithubPullRequestsRepository.toPgTimestampUtc(
      toDate(now.add({ milliseconds: leaseMs })),
    );
    const freshSince = PrismaGithubPullRequestsRepository.toPgTimestampUtc(
      toDate(now.subtract({ milliseconds: freshMappingMs })),
    );
    const claimed = await this.prisma.$executeRaw`
      INSERT INTO "GithubBranchPullRequestCheck" (
        "id", "organizationId", "repositoryHost", "repositoryFullName",
        "headBranch", "lastCheckedAt", "prCount", "notFoundAt",
        "recheckAfter", "attempts", "lastRequestedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${generate(GITHUB_BRANCH_CHECK_KSUID_RESOURCE).toString()}, ${organizationId}, ${host}, ${fullName},
        ${headBranch}, ${at}::timestamp, 0, NULL,
        ${leaseUntil}::timestamp, 0, ${at}::timestamp, ${at}::timestamp, ${at}::timestamp
      )
      ON CONFLICT ("organizationId", "repositoryHost", "repositoryFullName", "headBranch")
      DO UPDATE SET
        "recheckAfter" = ${leaseUntil}::timestamp,
        "lastRequestedAt" = CASE
          WHEN ${shouldRecordDemand}::boolean THEN ${at}::timestamp
          ELSE "GithubBranchPullRequestCheck"."lastRequestedAt"
        END,
        "updatedAt" = ${at}::timestamp
      WHERE
        ("GithubBranchPullRequestCheck"."recheckAfter" IS NULL
          OR "GithubBranchPullRequestCheck"."recheckAfter" <= ${at}::timestamp)
        AND NOT (
          "GithubBranchPullRequestCheck"."prCount" > 0
          AND "GithubBranchPullRequestCheck"."lastCheckedAt" > ${freshSince}::timestamp
        )
    `;
    return claimed > 0;
  }

  async touchBranchCheckRequestedAt({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
    lastRequestedAt,
    staleBefore,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastRequestedAt: Instant;
    staleBefore: Instant;
  }): Promise<void> {
    await this.prisma.githubBranchPullRequestCheck.updateMany({
      where: {
        organizationId,
        repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost),
        repositoryFullName:
          PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName),
        headBranch,
        lastRequestedAt: { lte: toDate(staleBefore) },
      },
      data: { lastRequestedAt: toDate(lastRequestedAt) },
    });
  }

  async bringBranchRecheckForward({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
    dueAt,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    dueAt: Instant;
  }): Promise<void> {
    await this.prisma.githubBranchPullRequestCheck.updateMany({
      where: {
        organizationId,
        repositoryHost: PrismaGithubPullRequestsRepository.normalizeHost(repositoryHost),
        repositoryFullName:
          PrismaGithubPullRequestsRepository.normalizeFullName(repositoryFullName),
        headBranch,
        // Only a branch waiting longer than this. A row already due sooner is
        // left alone, which is also what keeps a live lookup claim, whose lease
        // sits seconds away, from being extended by a concurrent fold.
        recheckAfter: { gt: toDate(dueAt) },
      },
      data: { recheckAfter: toDate(dueAt), attempts: 0 },
    });
  }

  /**
   * The cross-organization sweep read — deliberately allowed to span tenants
   * (see the interface docblock). Its three predicates are matched LITERALLY
   * by the org-tenancy guard (`dbOrganizationIdProtection`); change both together.
   */
  async findRecheckDue({
    now,
    activeWithinMs,
    limit,
  }: {
    now: Instant;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    const records = await this.prisma.githubBranchPullRequestCheck.findMany({
      where: {
        notFoundAt: { not: null },
        recheckAfter: { lte: toDate(now) },
        lastRequestedAt: { gt: toDate(now.subtract({ milliseconds: activeWithinMs })) },
      },
      orderBy: { recheckAfter: "asc" },
      take: limit,
    });
    return records.map((record) => PrismaGithubPullRequestsRepository.toBranchCheckRow(record));
  }

  /**
   * Retention prune for stale branch bookkeeping. Raw SQL with tenancy opt-out
   * because retention is system-owned maintenance.
   */
  async deleteStaleBefore({ before }: { before: Instant }): Promise<{
    branchChecks: number;
  }> {
    const cutoff = PrismaGithubPullRequestsRepository.toPgTimestampUtc(toDate(before));
    const branchChecks = await this.prisma.$executeRaw`
      DELETE FROM "GithubBranchPullRequestCheck"
      WHERE "lastRequestedAt" < ${cutoff}::timestamp
      -- @tenancy: GitHub branch bookkeeping retention sweep (system-owned maintenance)
    `;
    return { branchChecks };
  }

  private static toPgTimestampUtc(value: Date): Date {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  /**
   * Repositories are stored lowercased so a lookup matches whatever casing the
   * session reported — applied on both read and write here, which makes it an
   * invariant of the table rather than a convention callers must remember.
   */
  private static normalizeFullName(repositoryFullName: string): string {
    return repositoryFullName.toLowerCase();
  }

  /**
   * Host normalization to lowercase for case-insensitive matching. Branches are
   * deliberately not folded.
   */
  private static normalizeHost(repositoryHost: string): string {
    return repositoryHost.toLowerCase();
  }

  private static toPullRequestRow(record: PullRequestRecord): GithubPullRequestRow {
    return {
      organizationId: record.organizationId,
      repositoryHost: record.repositoryHost,
      repositoryFullName: record.repositoryFullName,
      headBranch: record.headBranch,
      prNumber: record.prNumber,
      htmlUrl: record.htmlUrl,
      title: record.title,
      state: record.state,
      isDraft: record.isDraft,
      authorLogin: record.authorLogin,
      prCreatedAt: fromDate(record.prCreatedAt),
      prClosedAt: record.prClosedAt && fromDate(record.prClosedAt),
      prMergedAt: record.prMergedAt && fromDate(record.prMergedAt),
      prUpdatedAt: record.prUpdatedAt && fromDate(record.prUpdatedAt),
      mappedAt: fromDate(record.mappedAt),
      lastCheckedAt: fromDate(record.lastCheckedAt),
    };
  }

  /**
   * Freshness guard for monotonic snapshot writes: accept when stored row has
   * no timestamp or one at or before incoming snapshot's.
   */
  private static freshnessGuard(prUpdatedAt: Instant | null) {
    return {
      OR: [
        { prUpdatedAt: null },
        ...(prUpdatedAt ? [{ prUpdatedAt: { lte: toDate(prUpdatedAt) } }] : []),
      ],
    };
  }

  private static isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private static toBranchCheckRow(record: BranchCheckRecord): GithubBranchCheckRow {
    return {
      organizationId: record.organizationId,
      repositoryHost: record.repositoryHost,
      repositoryFullName: record.repositoryFullName,
      headBranch: record.headBranch,
      lastCheckedAt: fromDate(record.lastCheckedAt),
      prCount: record.prCount,
      notFoundAt: record.notFoundAt && fromDate(record.notFoundAt),
      recheckAfter: record.recheckAfter && fromDate(record.recheckAfter),
      attempts: record.attempts,
      lastRequestedAt: fromDate(record.lastRequestedAt),
    };
  }
}
