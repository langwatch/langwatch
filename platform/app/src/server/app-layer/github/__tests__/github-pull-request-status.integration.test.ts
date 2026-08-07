/**
 * @vitest-environment node
 * @integration
 *
 * The live status read against the real Redis it caches in and the real
 * Postgres it falls back to. The unit test covers what each state derives to;
 * this covers that a second reader inside the window costs GitHub nothing.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { GithubInstallationsService } from "../github-installations.service";
import { GithubPullRequestStatusService } from "../github-pull-request-status.service";
import type { GithubAppTokenService, RedisLike } from "../githubAppToken";
import { PrismaGithubInstallationsRepository } from "../repositories/github-installations.prisma.repository";
import { PrismaGithubPullRequestsRepository } from "../repositories/github-pull-requests.prisma.repository";

const tag = nanoid(8);
/**
 * The spelling a reader arrives with, mixed case on both halves: hosts are case
 * insensitive and a session records whatever casing its git remote carries. The
 * store folds host and repository on every read and write, so the status cache
 * sitting in front of it has to fold the same way, or one pull request's status
 * splits across as many entries as there are spellings and each pays its own
 * GitHub call.
 */
const REPO_HOST = "GitHub.com";
const REPO_FULL_NAME = `Acme-${tag}/Widgets`;
/** The one spelling the store and its cache key resolve to. */
const FOLDED_HOST = REPO_HOST.toLowerCase();
const FOLDED_REPO_FULL_NAME = REPO_FULL_NAME.toLowerCase();
const INSTALLATION_ID = `8${Date.now().toString().slice(-8)}`;
const PR_NUMBER = 41;

const REF = {
  repositoryHost: REPO_HOST,
  repositoryFullName: REPO_FULL_NAME,
  prNumber: PR_NUMBER,
};

let redis: Redis;
let organizationId: string;

const repository = new PrismaGithubPullRequestsRepository(prisma);

function cacheKey(): string {
  return `gh:prstatus:${organizationId}:${FOLDED_HOST}:${FOLDED_REPO_FULL_NAME}:${PR_NUMBER}`;
}

function serviceWith(getPullRequest: ReturnType<typeof vi.fn>) {
  const appTokens = {
    configured: true,
    getPullRequest,
    listInstallationRepositories: vi
      .fn()
      .mockResolvedValue([{ id: "999", fullName: REPO_FULL_NAME }]),
  } as unknown as GithubAppTokenService;

  return new GithubPullRequestStatusService({
    repository,
    installations: new GithubInstallationsService(
      new PrismaGithubInstallationsRepository(prisma),
      appTokens,
    ),
    appTokens,
    redis: redis as unknown as RedisLike,
  });
}

/**
 * The stored snapshot as the mapping first wrote it, under the folded spelling
 * the store keys by. Re-applied per test because a live read that finds GitHub
 * has moved on writes the new state back, which is the behaviour one of these
 * tests is about.
 */
async function seedOpenSnapshot(): Promise<void> {
  await repository.upsertPullRequests({
    pullRequests: [
      {
        organizationId,
        repositoryHost: FOLDED_HOST,
        repositoryFullName: FOLDED_REPO_FULL_NAME,
        headBranch: "feat/linkage",
        prNumber: PR_NUMBER,
        htmlUrl: `https://github.com/${FOLDED_REPO_FULL_NAME}/pull/${PR_NUMBER}`,
        title: "Link sessions to pull requests",
        state: "open",
        isDraft: false,
        authorLogin: "someone",
        prCreatedAt: new Date(Date.now() - 60 * 60 * 1000),
        prClosedAt: null,
        prMergedAt: null,
      },
    ],
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  redis = containers.redisConnection;

  const organization = await prisma.organization.create({
    data: { name: `pr-status-${tag}`, slug: `pr-status-${tag}` },
  });
  organizationId = organization.id;

  await prisma.githubInstallation.create({
    data: {
      installationId: INSTALLATION_ID,
      organizationId,
      accountLogin: `acme-${tag}`,
      accountType: "Organization",
      accountId: "1",
      repositorySelection: "selected",
      repositories: [{ id: "999", fullName: REPO_FULL_NAME }],
    },
  });
}, 60_000);

beforeEach(async () => {
  await redis.del(cacheKey());
  await seedOpenSnapshot();
});

afterAll(async () => {
  if (redis && organizationId) await redis.del(cacheKey());
  if (organizationId) {
    await cleanupTestRows(prisma, [
      ["githubPullRequest", { organizationId }],
      ["githubInstallation", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
  }
  await stopTestContainers();
});

describe("live pull-request status", () => {
  describe("given a pull request whose live status was just read", () => {
    /** @scenario "Live status is cached briefly" */
    it("does not ask GitHub a second time within the cache window", async () => {
      const getPullRequest = vi.fn().mockResolvedValue({
        number: PR_NUMBER,
        htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
        title: "Link sessions to pull requests",
        state: "open",
        draft: true,
        mergedAt: null,
        closedAt: null,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        authorLogin: "someone",
      });
      const service = serviceWith(getPullRequest);

      const first = await service.getLiveStatuses({
        organizationId,
        refs: [REF],
      });
      const second = await service.getLiveStatuses({
        organizationId,
        refs: [REF],
      });

      expect(getPullRequest).toHaveBeenCalledTimes(1);
      expect(first[0]?.status).toBe("draft");
      expect(second[0]?.status).toBe("draft");
      expect(second[0]?.source).toBe("live");

      // Briefly: the entry carries a TTL rather than living until eviction,
      // because state is the one thing about a pull request that moves.
      const ttl = await redis.ttl(cacheKey());
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe("given a live read that fails", () => {
    it("answers from the stored snapshot and caches nothing", async () => {
      const service = serviceWith(
        vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT")),
      );

      const [status] = await service.getLiveStatuses({
        organizationId,
        refs: [REF],
      });

      expect(status?.status).toBe("open");
      expect(status?.source).toBe("snapshot");
      // Nothing is cached, so the very next reader gets a fresh attempt rather
      // than a minute of a stale label with a "live" badge on it.
      expect(await redis.get(cacheKey())).toBeNull();
    });
  });

  describe("given GitHub reports a state the snapshot has not caught up with", () => {
    it("writes the moved state back onto the stored row", async () => {
      const mergedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const service = serviceWith(
        vi.fn().mockResolvedValue({
          number: PR_NUMBER,
          htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
          title: "Link sessions to pull requests",
          state: "closed",
          draft: false,
          mergedAt,
          closedAt: mergedAt,
          createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          authorLogin: "someone",
        }),
      );

      const [status] = await service.getLiveStatuses({
        organizationId,
        refs: [REF],
      });
      expect(status?.status).toBe("merged");

      await vi.waitFor(
        async () => {
          const stored = await repository.findByNumber({
            organizationId,
            ...REF,
          });
          expect(stored?.state).toBe("closed");
          expect(stored?.prMergedAt).not.toBeNull();
        },
        { timeout: 5_000, interval: 100 },
      );
    });
  });
});
