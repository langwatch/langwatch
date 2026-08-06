import type { PrismaClient } from "@prisma/client";

import type {
  GithubBranchCheckRow,
  GithubPullRequestRow,
  GithubPullRequestsRepository,
  RefreshGithubPullRequestSnapshotInput,
  UpsertGithubBranchCheckInput,
  UpsertGithubPullRequestInput,
} from "./github-pull-requests.repository";

/**
 * Repositories are stored lowercased so a lookup matches whatever casing the
 * session reported. Applied on both the read and the write side here, which is
 * what makes it an invariant of the table rather than a convention callers have
 * to remember.
 */
const normalizeFullName = (repositoryFullName: string): string =>
  repositoryFullName.toLowerCase();

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

function toPullRequestRow(record: PullRequestRecord): GithubPullRequestRow {
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
    prCreatedAt: record.prCreatedAt,
    prClosedAt: record.prClosedAt,
    prMergedAt: record.prMergedAt,
    mappedAt: record.mappedAt,
    lastCheckedAt: record.lastCheckedAt,
  };
}

function toBranchCheckRow(record: BranchCheckRecord): GithubBranchCheckRow {
  return {
    organizationId: record.organizationId,
    repositoryHost: record.repositoryHost,
    repositoryFullName: record.repositoryFullName,
    headBranch: record.headBranch,
    lastCheckedAt: record.lastCheckedAt,
    prCount: record.prCount,
    notFoundAt: record.notFoundAt,
    recheckAfter: record.recheckAfter,
    attempts: record.attempts,
    lastRequestedAt: record.lastRequestedAt,
  };
}

export class PrismaGithubPullRequestsRepository
  implements GithubPullRequestsRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async upsertPullRequests({
    pullRequests,
  }: {
    pullRequests: readonly UpsertGithubPullRequestInput[];
  }): Promise<void> {
    for (const pullRequest of pullRequests) {
      const repositoryFullName = normalizeFullName(
        pullRequest.repositoryFullName,
      );
      const snapshot = {
        headBranch: pullRequest.headBranch,
        htmlUrl: pullRequest.htmlUrl,
        title: pullRequest.title,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
        authorLogin: pullRequest.authorLogin,
        prCreatedAt: pullRequest.prCreatedAt,
        prClosedAt: pullRequest.prClosedAt,
        prMergedAt: pullRequest.prMergedAt,
        lastCheckedAt: new Date(),
      };
      await this.prisma.githubPullRequest.upsert({
        where: {
          organizationId_repositoryHost_repositoryFullName_prNumber: {
            organizationId: pullRequest.organizationId,
            repositoryHost: pullRequest.repositoryHost,
            repositoryFullName,
            prNumber: pullRequest.prNumber,
          },
        },
        create: {
          organizationId: pullRequest.organizationId,
          repositoryHost: pullRequest.repositoryHost,
          repositoryFullName,
          prNumber: pullRequest.prNumber,
          ...snapshot,
        },
        update: snapshot,
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
    if (headBranches.length === 0) return [];
    const records = await this.prisma.githubPullRequest.findMany({
      where: {
        organizationId,
        repositoryHost,
        repositoryFullName: normalizeFullName(repositoryFullName),
        headBranch: { in: [...headBranches] },
      },
      orderBy: { prCreatedAt: "asc" },
    });
    return records.map(toPullRequestRow);
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
    const records = await this.prisma.githubPullRequest.findMany({
      where: {
        organizationId,
        OR: keys.map((key) => ({
          repositoryHost: key.repositoryHost,
          repositoryFullName: normalizeFullName(key.repositoryFullName),
          headBranch: key.headBranch,
        })),
      },
      orderBy: { prCreatedAt: "asc" },
    });
    return records.map(toPullRequestRow);
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
          repositoryHost,
          repositoryFullName: normalizeFullName(repositoryFullName),
          prNumber,
        },
      },
    });
    return record ? toPullRequestRow(record) : null;
  }

  async refreshSnapshot(
    input: RefreshGithubPullRequestSnapshotInput,
  ): Promise<void> {
    await this.prisma.githubPullRequest.updateMany({
      where: {
        organizationId: input.organizationId,
        repositoryHost: input.repositoryHost,
        repositoryFullName: normalizeFullName(input.repositoryFullName),
        prNumber: input.prNumber,
      },
      data: {
        title: input.title,
        state: input.state,
        isDraft: input.isDraft,
        prClosedAt: input.prClosedAt,
        prMergedAt: input.prMergedAt,
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
          repositoryHost,
          repositoryFullName: normalizeFullName(repositoryFullName),
          headBranch,
        },
      },
    });
    return record ? toBranchCheckRow(record) : null;
  }

  async upsertBranchCheck(input: UpsertGithubBranchCheckInput): Promise<void> {
    const repositoryFullName = normalizeFullName(input.repositoryFullName);
    const bookkeeping = {
      lastCheckedAt: input.lastCheckedAt,
      prCount: input.prCount,
      notFoundAt: input.notFoundAt,
      recheckAfter: input.recheckAfter,
      attempts: input.attempts,
      lastRequestedAt: input.lastRequestedAt,
    };
    await this.prisma.githubBranchPullRequestCheck.upsert({
      where: {
        organizationId_repositoryHost_repositoryFullName_headBranch: {
          organizationId: input.organizationId,
          repositoryHost: input.repositoryHost,
          repositoryFullName,
          headBranch: input.headBranch,
        },
      },
      create: {
        organizationId: input.organizationId,
        repositoryHost: input.repositoryHost,
        repositoryFullName,
        headBranch: input.headBranch,
        ...bookkeeping,
      },
      update: bookkeeping,
    });
  }

  async touchBranchCheckRequestedAt({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
    lastRequestedAt,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastRequestedAt: Date;
  }): Promise<void> {
    await this.prisma.githubBranchPullRequestCheck.updateMany({
      where: {
        organizationId,
        repositoryHost,
        repositoryFullName: normalizeFullName(repositoryFullName),
        headBranch,
      },
      data: { lastRequestedAt },
    });
  }

  /**
   * The cross-organization sweep read. The three predicates below are matched
   * LITERALLY by the org-tenancy guard's bound for this model, so a change here
   * has to be a deliberate change there too. See `dbOrganizationIdProtection`
   * and the interface docblock for why this one read is allowed to span
   * tenants at all.
   */
  async findRecheckDue({
    now,
    activeWithinMs,
    limit,
  }: {
    now: Date;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    const records = await this.prisma.githubBranchPullRequestCheck.findMany({
      where: {
        notFoundAt: { not: null },
        recheckAfter: { lte: now },
        lastRequestedAt: { gt: new Date(now.getTime() - activeWithinMs) },
      },
      orderBy: { recheckAfter: "asc" },
      take: limit,
    });
    return records.map(toBranchCheckRow);
  }
}
