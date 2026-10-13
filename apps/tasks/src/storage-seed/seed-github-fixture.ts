import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";

/**
 * A GitHub connection with no GitHub App behind it: one installation and two pull requests
 * mapped to branches, so the coding-agent pull-request reads answer on a local stack. The
 * branch matches telemetrysim's `claude-code-events` session context.
 */
export const SEED_GITHUB_REPOSITORY = "langwatch-seed/checkout";
const HOST = "github.com";

export const SEED_GITHUB_INSTALLATION = {
  id: "local-dev-github-installation",
  installationId: "9000000001",
  accountLogin: "langwatch-seed",
  accountType: "Organization",
  accountId: "9000000002",
  repositorySelection: "selected",
  repositories: [{ id: "9000000003", fullName: SEED_GITHUB_REPOSITORY }],
} as const;

export const SEED_GITHUB_PULL_REQUESTS = [
  {
    prNumber: 101,
    headBranch: "fix/flaky-checkout-test",
    title: "Fix the flaky checkout test in the payments suite",
    state: "open",
    isDraft: false,
    createdAt: "2026-10-01T09:00:00Z",
    closedAt: null,
    mergedAt: null,
  },
  {
    prNumber: 102,
    headBranch: "feat/retry-payments",
    title: "Retry failed payment captures",
    state: "closed",
    isDraft: false,
    createdAt: "2026-09-20T09:00:00Z",
    closedAt: "2026-09-22T15:00:00Z",
    mergedAt: "2026-09-22T15:00:00Z",
  },
] as const;

const at = (iso: string) => toDate(Temporal.Instant.from(iso));

export async function seedGithubFixture({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<void> {
  const { id, installationId, repositories, ...account } = SEED_GITHUB_INSTALLATION;
  await prisma.githubInstallation.upsert({
    where: { installationId },
    create: { id, installationId, organizationId, ...account, repositories: [...repositories] },
    update: {},
  });

  for (const pullRequest of SEED_GITHUB_PULL_REQUESTS) {
    const key = {
      organizationId,
      repositoryHost: HOST,
      repositoryFullName: SEED_GITHUB_REPOSITORY,
      prNumber: pullRequest.prNumber,
    };
    const createdAt = at(pullRequest.createdAt);
    const closedAt = pullRequest.closedAt && at(pullRequest.closedAt);
    await prisma.githubPullRequest.upsert({
      where: { organizationId_repositoryHost_repositoryFullName_prNumber: key },
      create: {
        ...key,
        headBranch: pullRequest.headBranch,
        htmlUrl: `https://${HOST}/${SEED_GITHUB_REPOSITORY}/pull/${pullRequest.prNumber}`,
        title: pullRequest.title,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
        authorLogin: "langwatch-seed-dev",
        prCreatedAt: createdAt,
        prClosedAt: closedAt,
        prMergedAt: pullRequest.mergedAt && at(pullRequest.mergedAt),
        prUpdatedAt: closedAt ?? createdAt,
      },
      update: {},
    });
  }
}
