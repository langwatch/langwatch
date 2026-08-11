import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { toPgTimestampUtc } from "~/server/utils/pgTimestamp";

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

/**
 * The host half of the same key, folded for the same reason.
 *
 * Every key this table is addressed by spans (organization, host, repository,
 * branch or number), so folding the repository alone still lets one repository
 * split in two: a caller naming `GitHub.com` matches no row a caller naming
 * `github.com` wrote. Hosts are case insensitive, `host` arrives straight off a
 * public query parameter, and a session records whatever casing its git remote
 * carries, so both spellings genuinely reach this layer.
 *
 * `headBranch` is deliberately never folded: `feat/X` and `feat/x` really are
 * two branches.
 */
const normalizeHost = (repositoryHost: string): string =>
  repositoryHost.toLowerCase();

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
            repositoryHost: normalizeHost(pullRequest.repositoryHost),
            repositoryFullName,
            prNumber: pullRequest.prNumber,
          },
        },
        create: {
          organizationId: pullRequest.organizationId,
          repositoryHost: normalizeHost(pullRequest.repositoryHost),
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
        repositoryHost: normalizeHost(repositoryHost),
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
          repositoryHost: normalizeHost(key.repositoryHost),
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
          repositoryHost: normalizeHost(repositoryHost),
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
        repositoryHost: normalizeHost(input.repositoryHost),
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
          repositoryHost: normalizeHost(repositoryHost),
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
          repositoryHost: normalizeHost(input.repositoryHost),
          repositoryFullName,
          headBranch: input.headBranch,
        },
      },
      create: {
        organizationId: input.organizationId,
        repositoryHost: normalizeHost(input.repositoryHost),
        repositoryFullName,
        headBranch: input.headBranch,
        ...bookkeeping,
      },
      update: bookkeeping,
    });
  }

  /**
   * The atomic claim. One INSERT ... ON CONFLICT DO UPDATE ... WHERE, so the
   * decision "may I ask GitHub about this branch" and the record of having
   * taken it are the same write.
   *
   * Raw SQL for the WHERE on the conflict path, which Prisma's `upsert` cannot
   * express: its `update` is unconditional, and the whole point here is that
   * the update must match nothing when another caller already holds the claim.
   * The statement names its organization, so this is not a tenancy opt-out —
   * the guard is a Prisma middleware and simply does not see raw SQL.
   *
   * Both concurrent callers reach the same conflict target; Postgres serializes
   * them on the unique index, so the second evaluates its predicate against the
   * first's committed row and updates zero rows.
   */
  async claimBranchLookup({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranch,
    now,
    freshMappingMs,
    leaseMs,
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    now: Date;
    freshMappingMs: number;
    leaseMs: number;
  }): Promise<boolean> {
    const fullName = normalizeFullName(repositoryFullName);
    const host = normalizeHost(repositoryHost);
    // Naive-UTC `::timestamp` literals: a raw JS Date binds as `timestamptz`
    // and the comparison then runs through the session timezone, which on a
    // developer's machine makes a fifteen-minute backoff look already elapsed
    // and lets every racer claim. See `toPgTimestampUtc`.
    const at = toPgTimestampUtc(now);
    const leaseUntil = toPgTimestampUtc(new Date(now.getTime() + leaseMs));
    const freshSince = toPgTimestampUtc(
      new Date(now.getTime() - freshMappingMs),
    );
    const claimed = await this.prisma.$executeRaw`
      INSERT INTO "GithubBranchPullRequestCheck" (
        "id", "organizationId", "repositoryHost", "repositoryFullName",
        "headBranch", "lastCheckedAt", "prCount", "notFoundAt",
        "recheckAfter", "attempts", "lastRequestedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${nanoid()}, ${organizationId}, ${host}, ${fullName},
        ${headBranch}, ${at}::timestamp, 0, NULL,
        ${leaseUntil}::timestamp, 0, ${at}::timestamp, ${at}::timestamp, ${at}::timestamp
      )
      ON CONFLICT ("organizationId", "repositoryHost", "repositoryFullName", "headBranch")
      DO UPDATE SET
        "recheckAfter" = ${leaseUntil}::timestamp,
        "lastRequestedAt" = ${at}::timestamp,
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
    lastRequestedAt: Date;
    staleBefore: Date;
  }): Promise<void> {
    await this.prisma.githubBranchPullRequestCheck.updateMany({
      where: {
        organizationId,
        repositoryHost: normalizeHost(repositoryHost),
        repositoryFullName: normalizeFullName(repositoryFullName),
        headBranch,
        lastRequestedAt: { lte: staleBefore },
      },
      data: { lastRequestedAt },
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
    dueAt: Date;
  }): Promise<void> {
    await this.prisma.githubBranchPullRequestCheck.updateMany({
      where: {
        organizationId,
        repositoryHost: normalizeHost(repositoryHost),
        repositoryFullName: normalizeFullName(repositoryFullName),
        headBranch,
        // Only a branch waiting longer than this. A row already due sooner is
        // left alone, which is also what keeps a live lookup claim, whose lease
        // sits seconds away, from being extended by a concurrent fold.
        recheckAfter: { gt: dueAt },
      },
      data: { recheckAfter: dueAt, attempts: 0 },
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

  /**
   * The retention prune. Two statements, in this order: the branch bookkeeping
   * past the horizon, then the pull requests whose branch no longer has a row
   * at all. Reversing them would leave a pull request orphaned for a day.
   *
   * Raw SQL, with the `-- @tenancy:` opt-out every other retention sweep in the
   * platform uses. Retention is system-owned maintenance and cannot name an
   * organization: the alternative is enumerating every organization and issuing
   * a delete per tenant, which is a query per tenant to do one table scan's
   * work.
   *
   * Both are single unbounded DELETEs over a predicate with no index of its
   * own, and that is the deliberate trade: this runs once a day, while an index
   * to serve it would be paid on every write to a table that takes a row per
   * agent branch. Measured on 200k rows: 254 ms for the branch checks, 32 ms
   * for the anti-join (which does use the branch table's unique index).
   */
  async deleteStaleBefore({ before }: { before: Date }): Promise<{
    branchChecks: number;
    pullRequests: number;
  }> {
    const cutoff = toPgTimestampUtc(before);
    const branchChecks = await this.prisma.$executeRaw`
      DELETE FROM "GithubBranchPullRequestCheck"
      WHERE "lastRequestedAt" < ${cutoff}::timestamp
      -- @tenancy: GitHub branch bookkeeping retention sweep (system-owned maintenance)
    `;
    const pullRequests = await this.prisma.$executeRaw`
      DELETE FROM "GithubPullRequest" pr
      WHERE NOT EXISTS (
        SELECT 1 FROM "GithubBranchPullRequestCheck" bc
        WHERE bc."organizationId" = pr."organizationId"
          AND bc."repositoryHost" = pr."repositoryHost"
          AND bc."repositoryFullName" = pr."repositoryFullName"
          AND bc."headBranch" = pr."headBranch"
      )
      -- @tenancy: GitHub pull-request retention sweep (system-owned maintenance)
    `;
    return { branchChecks, pullRequests };
  }
}
