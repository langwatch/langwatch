/**
 * @vitest-environment node
 * @integration
 *
 * Branch to pull-request mapping against the real stores: the Postgres tables
 * that hold the pull requests and their per-branch bookkeeping, the org-tenancy
 * middleware every query goes through, and the ClickHouse session rows the
 * post-connect backfill reads. Only GitHub itself is a stand-in, and only at the
 * token service's own seam.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
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
import { createPullRequestMappingReactor } from "../../../event-sourcing/pipelines/coding-agent-processing/reactors/pullRequestMapping.reactor";
import { CodingAgentSessionService } from "../../coding-agent/coding-agent-session.service";
import { CodingAgentSessionClickHouseRepository } from "../../coding-agent/repositories/coding-agent-session.clickhouse.repository";
import { NullCodingAgentSessionEventsRepository } from "../../coding-agent/repositories/coding-agent-session-events.repository";
import { NullCodingAgentTraceSessionRepository } from "../../coding-agent/repositories/coding-agent-trace-session.repository";
import { NullSessionMetricSeriesRepository } from "../../coding-agent/repositories/session-metric-series.repository";
import { traced } from "../../tracing";
import {
  RECHECK_ACTIVE_WITHIN_MS,
  runBranchRecheckPass,
} from "../github-branch-recheck.worker";
import { GithubInstallationsService } from "../github-installations.service";
import { GithubPullRequestMappingService } from "../github-pull-request-mapping.service";
import {
  type GithubAppTokenService,
  GithubRateLimitedError,
} from "../githubAppToken";
import { PrismaGithubInstallationsRepository } from "../repositories/github-installations.prisma.repository";
import { PrismaGithubPullRequestsRepository } from "../repositories/github-pull-requests.prisma.repository";
import { codingAgentSessionRow } from "./codingAgentSessionRowFixture";

const tag = nanoid(8);
const REPO_FULL_NAME = `acme-${tag}/widgets`;
const INSTALLATION_ID = `9${Date.now().toString().slice(-8)}`;

let ch: ClickHouseClient;
let organizationId: string;
let projectId: string;

const repository = new PrismaGithubPullRequestsRepository(prisma);

/** A pull request as GitHub's API would describe it, through the token seam. */
function apiPullRequest(over: Partial<Record<string, unknown>> = {}) {
  return {
    number: 41,
    htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/41`,
    title: "Link sessions to pull requests",
    state: "open",
    draft: false,
    mergedAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    authorLogin: "someone",
    ...over,
  } as never;
}

/**
 * The real installations service over the real Postgres row, with only the two
 * GitHub calls stubbed. A "selected" installation carrying a cached repository
 * list resolves without any live listing, so the mapping's own repository
 * resolution is genuinely exercised.
 */
function servicesWith({
  listPullRequestsForHead,
  sessions,
}: {
  listPullRequestsForHead: ReturnType<typeof vi.fn>;
  sessions?: CodingAgentSessionService;
}) {
  const appTokens = {
    configured: true,
    listPullRequestsForHead,
    getInstallation: vi.fn().mockResolvedValue({
      installationId: INSTALLATION_ID,
      accountLogin: `acme-${tag}`,
      accountType: "Organization",
      accountId: "1",
      repositorySelection: "selected",
    }),
    listInstallationRepositories: vi
      .fn()
      .mockResolvedValue([{ id: "999", fullName: REPO_FULL_NAME }]),
  } as unknown as GithubAppTokenService;

  const sessionService =
    sessions ??
    new CodingAgentSessionService({
      sessions: new CodingAgentSessionClickHouseRepository(async () => ch),
      traceSessions: new NullCodingAgentTraceSessionRepository(),
      metricSeries: new NullSessionMetricSeriesRepository(),
      sessionEvents: new NullCodingAgentSessionEventsRepository(),
    });

  let mapping: GithubPullRequestMappingService | null = null;
  // Wrapped the way the composition root publishes them, so the proxy every
  // production call goes through, the one `this` is bound to inside these
  // services, is part of what these tests exercise.
  const installations = traced(
    new GithubInstallationsService(
      new PrismaGithubInstallationsRepository(prisma),
      appTokens,
      ({ organizationId: orgId }) =>
        mapping?.runBackfillForOrganization({ organizationId: orgId }),
    ),
    "GithubInstallationsService",
  );
  mapping = traced(
    new GithubPullRequestMappingService({
      repository,
      installations,
      appTokens,
      resolveOrganizationId: async (id) =>
        id === projectId ? organizationId : undefined,
      findProjectIds: async () => [projectId],
      sessions: sessionService,
    }),
    "GithubPullRequestMappingService",
  );

  return { mapping, installations, appTokens };
}

async function seedInstallation(): Promise<void> {
  await prisma.githubInstallation.upsert({
    where: { installationId: INSTALLATION_ID },
    create: {
      installationId: INSTALLATION_ID,
      organizationId,
      accountLogin: `acme-${tag}`,
      accountType: "Organization",
      accountId: "1",
      repositorySelection: "selected",
      repositories: [{ id: "999", fullName: REPO_FULL_NAME }],
    },
    update: { organizationId },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const organization = await prisma.organization.create({
    data: { name: `pr-map-${tag}`, slug: `pr-map-${tag}` },
  });
  organizationId = organization.id;
  const team = await prisma.team.create({
    data: {
      name: `pr-map-${tag}`,
      slug: `pr-map-${tag}`,
      organizationId,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `pr-map-${tag}`,
      slug: `pr-map-${tag}`,
      apiKey: `pr-map-${tag}`,
      teamId: team.id,
      language: "typescript",
      framework: "other",
    },
  });
  projectId = project.id;
}, 60_000);

beforeEach(async () => {
  await cleanupTestRows(prisma, [
    ["githubPullRequest", { organizationId }],
    ["githubBranchPullRequestCheck", { organizationId }],
  ]);
});

afterAll(async () => {
  if (organizationId) {
    await cleanupTestRows(prisma, [
      ["githubPullRequest", { organizationId }],
      ["githubBranchPullRequestCheck", { organizationId }],
      ["githubInstallation", { organizationId }],
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
  }
  if (ch && projectId) {
    await ch.exec({
      query:
        "ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: projectId },
    });
  }
  await stopTestContainers();
});

describe("branch pull-request mapping", () => {
  describe("given an organization with a GitHub connection covering the session's repository", () => {
    /** @scenario "A folded session carrying repo and branch maps its branch's pull requests" */
    it("stores every pull request whose head is that branch", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValue([
        apiPullRequest({ number: 41 }),
        apiPullRequest({
          number: 42,
          htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/42`,
        }),
      ]);
      const { mapping } = servicesWith({ listPullRequestsForHead });

      // Driven through the reactor, so the fold-side trigger is part of what
      // this proves rather than something the test steps around.
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: (params) => mapping.requestBranchMapping(params),
      });
      await reactor.handle(
        {} as never,
        {
          tenantId: projectId,
          aggregateId: "session-1",
          foldState: {
            repositoryHost: "github.com",
            repositoryOwner: `acme-${tag}`,
            repositoryName: "widgets",
            gitBranch: "feat/linkage",
          },
        } as never,
      );

      const stored = await repository.findAllByBranches({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranches: ["feat/linkage"],
      });

      expect(stored.map((row) => row.prNumber).sort()).toEqual([41, 42]);
      expect(stored[0]?.headBranch).toBe("feat/linkage");
      // Stored lowercased so a lookup matches whatever casing a session used.
      expect(stored[0]?.repositoryFullName).toBe(REPO_FULL_NAME.toLowerCase());

      const check = await repository.findBranchCheck({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranch: "feat/linkage",
      });
      expect(check?.prCount).toBe(2);
      expect(check?.notFoundAt).toBeNull();
      expect(check?.recheckAfter).toBeNull();
    });
  });

  describe("given a mapped branch that has no pull request yet", () => {
    /** @scenario "An empty answer arms the negative cache" */
    it("does not ask GitHub a second time inside the backoff window", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValue([]);
      const { mapping } = servicesWith({ listPullRequestsForHead });
      const request = {
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/no-pr",
      };

      await mapping.requestBranchMapping(request);
      await mapping.requestBranchMapping(request);
      await mapping.requestBranchMapping(request);

      expect(listPullRequestsForHead).toHaveBeenCalledTimes(1);

      const check = await repository.findBranchCheck({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranch: "feat/no-pr",
      });
      expect(check?.prCount).toBe(0);
      expect(check?.attempts).toBe(1);
      expect(check?.notFoundAt).not.toBeNull();
      expect(check?.recheckAfter?.getTime()).toBeGreaterThan(Date.now());
    });

    it("arms the backoff without claiming absence when GitHub rate limits us", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi
          .fn()
          .mockRejectedValue(
            new GithubRateLimitedError({ retryAfterSec: 60, resetAt: null }),
          ),
      });

      await expect(
        mapping.requestBranchMapping({
          tenantId: projectId,
          repositoryHost: "github.com",
          repositoryOwner: `acme-${tag}`,
          repositoryName: "widgets",
          headBranch: "feat/limited",
        }),
      ).resolves.toBeUndefined();

      const check = await repository.findBranchCheck({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranch: "feat/limited",
      });
      // A refusal to answer is not the same fact as "there is no pull request".
      expect(check?.notFoundAt).toBeNull();
      expect(check?.recheckAfter?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("given a session whose branch had no pull request when it folded", () => {
    /** @scenario "A pull request opened after the session went quiet is still found" */
    it("maps it on the periodic recheck, with no new session activity", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValueOnce([]);
      const { mapping } = servicesWith({ listPullRequestsForHead });

      await mapping.requestBranchMapping({
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/later",
      });
      expect(
        await repository.findAllByBranches({
          organizationId,
          repositoryHost: "github.com",
          repositoryFullName: REPO_FULL_NAME,
          headBranches: ["feat/later"],
        }),
      ).toEqual([]);

      // The pull request is opened, and the branch's backoff elapses.
      listPullRequestsForHead.mockResolvedValue([
        apiPullRequest({ number: 77 }),
      ]);
      await prisma.githubBranchPullRequestCheck.updateMany({
        where: { organizationId, headBranch: "feat/later" },
        data: { recheckAfter: new Date(Date.now() - 1000) },
      });

      const rechecked = await runBranchRecheckPass({
        repository,
        mapping,
      });

      expect(rechecked).toBeGreaterThanOrEqual(1);
      const stored = await repository.findAllByBranches({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranches: ["feat/later"],
      });
      expect(stored.map((row) => row.prNumber)).toEqual([77]);
      // Found clears the negative cache, so the sweep stops picking it up.
      const check = await repository.findBranchCheck({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranch: "feat/later",
      });
      expect(check?.notFoundAt).toBeNull();
    });

    it("leaves a branch nobody has asked about in a week out of the sweep", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi.fn().mockResolvedValue([]),
      });
      await mapping.requestBranchMapping({
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/abandoned",
      });
      await prisma.githubBranchPullRequestCheck.updateMany({
        where: { organizationId, headBranch: "feat/abandoned" },
        data: {
          recheckAfter: new Date(Date.now() - 1000),
          lastRequestedAt: new Date(
            Date.now() - RECHECK_ACTIVE_WITHIN_MS - 1000,
          ),
        },
      });

      const due = await repository.findRecheckDue({
        now: new Date(),
        activeWithinMs: RECHECK_ACTIVE_WITHIN_MS,
        limit: 50,
      });

      expect(due.some((row) => row.headBranch === "feat/abandoned")).toBe(
        false,
      );
    });
  });

  describe("given sessions with repo and branch folded before any GitHub connection existed", () => {
    /** @scenario "Connecting GitHub backfills recent branches" */
    it("maps the recent branches without waiting for new sessions", async () => {
      const sessionRepository = new CodingAgentSessionClickHouseRepository(
        async () => ch,
      );
      for (const branch of ["feat/backfill-a", "feat/backfill-b"]) {
        await sessionRepository.upsert(
          codingAgentSessionRow({
            tenantId: projectId,
            sessionId: `${tag}-${branch}`,
            startedAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
            repositoryHost: "github.com",
            repositoryOwner: `acme-${tag}`,
            repositoryName: "widgets",
            gitBranch: branch,
          }),
        );
      }

      const listPullRequestsForHead = vi
        .fn()
        .mockImplementation(async ({ branch }: { branch: string }) => [
          apiPullRequest({
            number: branch === "feat/backfill-a" ? 101 : 102,
          }),
        ]);
      const { installations } = servicesWith({ listPullRequestsForHead });
      await seedInstallation();

      // The seam under test: recording the installation is what triggers it.
      await installations.recordInstallation({
        installationId: INSTALLATION_ID,
        organizationId,
      });
      // The hook is fire-and-forget by design, so wait for it to settle.
      await vi.waitFor(
        async () => {
          const stored = await repository.findAllByBranches({
            organizationId,
            repositoryHost: "github.com",
            repositoryFullName: REPO_FULL_NAME,
            headBranches: ["feat/backfill-a", "feat/backfill-b"],
          });
          expect(stored).toHaveLength(2);
        },
        { timeout: 15_000, interval: 250 },
      );

      const branchesAsked = listPullRequestsForHead.mock.calls.map(
        (call) => (call[0] as { branch: string }).branch,
      );
      expect(branchesAsked.sort()).toEqual([
        "feat/backfill-a",
        "feat/backfill-b",
      ]);
    });
  });

  describe("given a repository on a host the connection cannot answer for", () => {
    it("writes nothing and calls no GitHub endpoint", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn();
      const { mapping } = servicesWith({ listPullRequestsForHead });

      await mapping.requestBranchMapping({
        tenantId: projectId,
        repositoryHost: "gitlab.example.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/elsewhere",
      });

      expect(listPullRequestsForHead).not.toHaveBeenCalled();
      expect(
        await prisma.githubBranchPullRequestCheck.count({
          where: { organizationId, headBranch: "feat/elsewhere" },
        }),
      ).toBe(0);
    });
  });
});
