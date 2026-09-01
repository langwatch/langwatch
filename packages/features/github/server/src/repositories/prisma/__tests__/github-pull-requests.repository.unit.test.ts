/**
 * The key a pull request is stored and found under.
 *
 * Every read and write here is addressed by (organization, host, repository,
 * branch or number), and two of those parts arrive from places that disagree
 * about case: `repositoryHost` comes straight off a public query parameter,
 * and a session records whatever casing its git remote carries. Folding them
 * on the way in AND on the way out is what stops one repository splitting in
 * two — a caller naming `GitHub.com` finding no row a caller naming
 * `github.com` wrote.
 *
 * `headBranch` is deliberately not folded: `feat/X` and `feat/x` really are
 * two branches.
 *
 * The other rule is the freshness guard. Snapshots arrive out of order from
 * GitHub, so every write is conditional on the stored row not being newer.
 * Without it a late delivery would overwrite a fresher one and the pull
 * request would appear to move backwards.
 */

import { describe, expect, it } from "vitest";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../github-pull-requests.repository";

type Call = { method: string; args: Record<string, unknown> };

/** A Prisma stand-in that records the shape it was handed. */
function recordingDatabase(over: { updatedCount?: number } = {}) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    if (method === "githubPullRequest.updateMany") {
      return { count: over.updatedCount ?? 1 };
    }
    return [];
  };

  const database = {
    githubPullRequest: {
      findMany: record("githubPullRequest.findMany"),
      updateMany: record("githubPullRequest.updateMany"),
      create: record("githubPullRequest.create"),
      deleteMany: record("githubPullRequest.deleteMany"),
    },
    githubBranchPullRequestCheck: {
      findMany: record("githubBranchPullRequestCheck.findMany"),
      updateMany: record("githubBranchPullRequestCheck.updateMany"),
      create: record("githubBranchPullRequestCheck.create"),
      deleteMany: record("githubBranchPullRequestCheck.deleteMany"),
    },
    $executeRaw: async () => 0,
  };

  return {
    calls,
    repository: PrismaGithubPullRequestsRepository.create(
      database as unknown as PrismaGithubPullRequestsDatabase,
    ),
  };
}

const pullRequest = (over: Record<string, unknown> = {}) => ({
  organizationId: "organization-1",
  repositoryHost: "GitHub.com",
  repositoryFullName: "Acme/Refunds",
  prNumber: 7,
  headBranch: "feat/Refunds",
  htmlUrl: "https://github.com/acme/refunds/pull/7",
  title: "Refunds",
  state: "open",
  isDraft: false,
  authorLogin: "someone",
  prCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
  prClosedAt: null,
  prMergedAt: null,
  prUpdatedAt: new Date("2026-08-02T00:00:00.000Z"),
  ...over,
});

const whereOf = (calls: Call[], method: string) =>
  calls.find((call) => call.method === method)?.args.where as Record<string, unknown> | undefined;

describe("PrismaGithubPullRequestsRepository", () => {
  describe("given a host and repository in mixed case", () => {
    it("folds both before writing", async () => {
      const { calls, repository } = recordingDatabase();

      await repository.upsertPullRequests({
        pullRequests: [pullRequest()],
      } as never);

      expect(whereOf(calls, "githubPullRequest.updateMany")).toMatchObject({
        repositoryHost: "github.com",
        repositoryFullName: "acme/refunds",
      });
    });

    it("folds both before reading, so a read finds what a write stored", async () => {
      const { calls, repository } = recordingDatabase();

      await repository.findAllByBranches({
        organizationId: "organization-1",
        repositoryHost: "GITHUB.COM",
        repositoryFullName: "ACME/Refunds",
        headBranches: ["feat/Refunds"],
      } as never);

      expect(whereOf(calls, "githubPullRequest.findMany")).toMatchObject({
        repositoryHost: "github.com",
        repositoryFullName: "acme/refunds",
      });
    });

    it("leaves the branch alone, because case distinguishes two branches", async () => {
      const { calls, repository } = recordingDatabase();

      await repository.findAllByBranches({
        organizationId: "organization-1",
        repositoryHost: "github.com",
        repositoryFullName: "acme/refunds",
        headBranches: ["feat/Refunds"],
      } as never);

      expect(whereOf(calls, "githubPullRequest.findMany")).toMatchObject({
        headBranch: { in: ["feat/Refunds"] },
      });
    });
  });

  describe("the write's freshness guard", () => {
    it("refuses to overwrite a row that is already newer", async () => {
      // Snapshots arrive out of order. Without this a late delivery would
      // make the pull request appear to move backwards.
      const { calls, repository } = recordingDatabase();

      await repository.upsertPullRequests({
        pullRequests: [pullRequest({ prUpdatedAt: new Date("2026-08-02T00:00:00.000Z") })],
      } as never);

      expect(whereOf(calls, "githubPullRequest.updateMany")).toMatchObject({
        OR: [{ prUpdatedAt: null }, { prUpdatedAt: { lte: new Date("2026-08-02T00:00:00.000Z") } }],
      });
    });

    it("still writes a row that has never been stamped", async () => {
      // A row written before the column existed has a null stamp, and the
      // first real snapshot has to win over it rather than be refused.
      const { calls, repository } = recordingDatabase();

      await repository.upsertPullRequests({ pullRequests: [pullRequest()] } as never);
      const guard = whereOf(calls, "githubPullRequest.updateMany") as {
        OR: Array<Record<string, unknown>>;
      };

      expect(guard.OR).toContainEqual({ prUpdatedAt: null });
    });
  });

  /**
   * The sweep's read, whose three predicates are matched literally by the
   * org-tenancy guard's bound for this model: it is the one read here allowed
   * to span tenants, and it earns that by asking for branches that mapped to
   * nothing, are due now, and were demanded inside the activity window. Widen
   * any of the three and a cross-tenant scan starts returning rows nobody
   * asked about.
   */
  describe("the cross-organization sweep read", () => {
    /** @scenario "The sweep reads a bounded page of branches demanded recently" */
    it("asks only for unmapped branches that are due and recently demanded", async () => {
      const { calls, repository } = recordingDatabase();
      const now = new Date("2026-08-08T00:00:00.000Z");

      await repository.findRecheckDue({ now, activeWithinMs: 7 * 24 * 60 * 60 * 1000, limit: 50 });

      const call = calls.find((entry) => entry.method === "githubBranchPullRequestCheck.findMany");
      expect(call?.args).toEqual({
        where: {
          notFoundAt: { not: null },
          recheckAfter: { lte: now },
          lastRequestedAt: { gt: new Date("2026-08-01T00:00:00.000Z") },
        },
        orderBy: { recheckAfter: "asc" },
        take: 50,
      });
    });
  });

  describe("given the guarded update matched nothing", () => {
    it("creates the row instead, under the folded key", async () => {
      const { calls, repository } = recordingDatabase({ updatedCount: 0 });

      await repository.upsertPullRequests({ pullRequests: [pullRequest()] } as never);

      const created = calls.find((call) => call.method === "githubPullRequest.create");
      expect(created?.args.data).toMatchObject({
        repositoryHost: "github.com",
        repositoryFullName: "acme/refunds",
        prNumber: 7,
      });
    });
  });
});
