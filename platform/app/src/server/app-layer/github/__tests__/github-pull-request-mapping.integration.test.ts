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
  runBranchRetentionPrune,
} from "../github-branch-recheck.worker";
import { GithubInstallationsService } from "../github-installations.service";
import { GithubPullRequestMappingService } from "../github-pull-request-mapping.service";
import {
  type GithubAppTokenService,
  GithubRateLimitedError,
} from "../githubAppToken";
import { parseGithubPullRequestEvent } from "../githubPullRequestEvent";
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
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
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

/** A `pull_request` delivery, in the shape GitHub posts to the webhook route. */
function pullRequestDelivery({
  action = "opened",
  number = 41,
  branch = "feat/announced",
  state = "open",
  mergedAt = null,
  closedAt = null,
  title = "Link sessions to pull requests",
  updatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(),
}: {
  action?: string;
  number?: number;
  branch?: string;
  state?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  title?: string;
  /** GitHub's own `updated_at`: what orders this delivery against another. */
  updatedAt?: string;
} = {}) {
  return {
    action,
    installation: { id: INSTALLATION_ID },
    repository: {
      name: "widgets",
      full_name: REPO_FULL_NAME,
      owner: { login: `acme-${tag}` },
    },
    pull_request: {
      number,
      html_url: `https://github.com/${REPO_FULL_NAME}/pull/${number}`,
      title,
      state,
      draft: false,
      merged_at: mergedAt,
      closed_at: closedAt,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      updated_at: updatedAt,
      user: { login: "someone" },
      head: { ref: branch, repo: { full_name: REPO_FULL_NAME } },
    },
  };
}

/** Deliver one webhook the way the route does: parse first, then apply. */
async function deliver(
  mapping: GithubPullRequestMappingService,
  payload: unknown,
): Promise<boolean> {
  const event = parseGithubPullRequestEvent(payload);
  if (!event) throw new Error("the delivery did not parse");
  return await mapping.applyPullRequestEvent(event);
}

function branchCheckFor(headBranch: string) {
  return repository.findBranchCheck({
    organizationId,
    repositoryHost: "github.com",
    repositoryFullName: REPO_FULL_NAME,
    headBranch,
  });
}

function storedFor(headBranch: string) {
  return repository.findAllByBranches({
    organizationId,
    repositoryHost: "github.com",
    repositoryFullName: REPO_FULL_NAME,
    headBranches: [headBranch],
  });
}

/** Put a branch where the bug left it: four empty answers, a day-long wait. */
async function armLongestBackoff(headBranch: string): Promise<void> {
  await prisma.githubBranchPullRequestCheck.updateMany({
    where: { organizationId, headBranch },
    data: {
      attempts: 4,
      recheckAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
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

    /**
     * The workload this feature exists for: several agent worktrees on one
     * branch, folding within milliseconds of each other. The guard used to be a
     * read followed by a write, so both sessions read "nothing stored yet"
     * before either wrote, and both called GitHub. One statement cannot split
     * that way.
     */
    /** @scenario "Concurrent sessions on one branch ask GitHub once" */
    it("asks GitHub once when two sessions map the same branch at the same time", async () => {
      await seedInstallation();
      // Held open until both callers have raced the claim, so the second
      // cannot simply arrive after the first already recorded its answer —
      // the concurrency has to be real for the test to be about the guard.
      let releaseGitHub: () => void = () => undefined;
      const inFlight = new Promise<void>((resolve) => {
        releaseGitHub = resolve;
      });
      const listPullRequestsForHead = vi.fn().mockImplementation(async () => {
        await inFlight;
        return [apiPullRequest({ number: 77 })];
      });
      const { mapping } = servicesWith({ listPullRequestsForHead });
      const request = {
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/concurrent",
      };

      const both = Promise.all([
        mapping.requestBranchMapping(request),
        mapping.requestBranchMapping(request),
      ]);
      releaseGitHub();
      await both;

      expect(listPullRequestsForHead).toHaveBeenCalledTimes(1);

      const stored = await repository.findAllByBranches({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranches: ["feat/concurrent"],
      });
      expect(stored.map((row) => row.prNumber)).toEqual([77]);
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

  describe("given branches on both sides of the activity horizon", () => {
    /** @scenario "Linkage rows nobody asks about stop accumulating" */
    it("prunes the abandoned branch and its pull requests, and keeps the live one", async () => {
      await seedInstallation();
      // A distinct pull request per branch: the stored row is unique on the
      // pull-request NUMBER, so reusing one would move it between branches
      // instead of leaving one on each.
      const listPullRequestsForHead = vi
        .fn()
        .mockImplementationOnce(async () => [apiPullRequest({ number: 51 })])
        .mockImplementationOnce(async () => [apiPullRequest({ number: 52 })]);
      const { mapping } = servicesWith({ listPullRequestsForHead });

      for (const headBranch of ["feat/abandoned", "feat/still-read"]) {
        await mapping.requestBranchMapping({
          tenantId: projectId,
          repositoryHost: "github.com",
          repositoryOwner: `acme-${tag}`,
          repositoryName: "widgets",
          headBranch,
        });
      }
      // Only the abandoned branch falls outside the window; the live one keeps
      // the `lastRequestedAt` its mapping run just wrote.
      await prisma.githubBranchPullRequestCheck.updateMany({
        where: { organizationId, headBranch: "feat/abandoned" },
        data: {
          lastRequestedAt: new Date(Date.now() - RECHECK_ACTIVE_WITHIN_MS - 1),
        },
      });

      const pruned = await runBranchRetentionPrune({ repository });

      expect(pruned.branchChecks).toBe(1);
      expect(pruned.pullRequests).toBeGreaterThanOrEqual(1);

      const remainingChecks =
        await prisma.githubBranchPullRequestCheck.findMany({
          where: { organizationId },
          select: { headBranch: true },
        });
      expect(remainingChecks.map((row) => row.headBranch)).toEqual([
        "feat/still-read",
      ]);

      const remainingPullRequests = await prisma.githubPullRequest.findMany({
        where: { organizationId },
        select: { headBranch: true },
      });
      expect(remainingPullRequests.map((row) => row.headBranch)).toEqual([
        "feat/still-read",
      ]);
    });
  });

  describe("given GitHub announces a pull request over the webhook", () => {
    /** @scenario "A pull request opened on a branch is linked without waiting for a recheck" */
    it("stores it straight away and never lists the branch", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn();
      const { mapping } = servicesWith({ listPullRequestsForHead });

      const applied = await deliver(
        mapping,
        pullRequestDelivery({ branch: "feat/announced", number: 41 }),
      );

      expect(applied).toBe(true);
      const stored = await storedFor("feat/announced");
      expect(stored.map((row) => row.prNumber)).toEqual([41]);
      expect(stored[0]?.state).toBe("open");
      expect(stored[0]?.authorLogin).toBe("someone");
      // Stored lowercased, exactly as a listing's answer would be.
      expect(stored[0]?.repositoryFullName).toBe(REPO_FULL_NAME.toLowerCase());
      expect(listPullRequestsForHead).not.toHaveBeenCalled();
    });

    /** @scenario "The announcement clears the branch's backoff" */
    it("clears a day-long wait and puts the ladder back at its first rung", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValue([]);
      const { mapping } = servicesWith({ listPullRequestsForHead });
      await mapping.mapBranch({
        organizationId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/backed-off",
      });
      await armLongestBackoff("feat/backed-off");

      await deliver(
        mapping,
        pullRequestDelivery({ branch: "feat/backed-off", number: 61 }),
      );

      const linked = await branchCheckFor("feat/backed-off");
      expect(linked?.recheckAfter).toBeNull();
      expect(linked?.notFoundAt).toBeNull();
      expect(linked?.attempts).toBe(0);

      // And the ladder really starts over: age the branch past the freshness
      // window so the next lookup is allowed, and let it answer empty.
      await prisma.githubBranchPullRequestCheck.updateMany({
        where: { organizationId, headBranch: "feat/backed-off" },
        data: { lastCheckedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });
      await mapping.mapBranch({
        organizationId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/backed-off",
      });

      const afterEmpty = await branchCheckFor("feat/backed-off");
      expect(afterEmpty?.attempts).toBe(1);
      // The shortest rung, not the longest one it was sitting on.
      expect(afterEmpty?.recheckAfter?.getTime()).toBeLessThan(
        Date.now() + 20 * 60 * 1000,
      );
    });

    /** @scenario "A pull request that merges is announced as merged" */
    it("turns the stored pull request from open into merged", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi.fn(),
      });
      await deliver(
        mapping,
        pullRequestDelivery({ branch: "feat/merging", number: 71 }),
      );
      expect((await storedFor("feat/merging"))[0]?.prMergedAt).toBeNull();

      const mergedAt = new Date().toISOString();
      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/merging",
          number: 71,
          action: "closed",
          state: "closed",
          mergedAt,
          closedAt: mergedAt,
          updatedAt: mergedAt,
        }),
      );

      const stored = await storedFor("feat/merging");
      expect(stored).toHaveLength(1);
      expect(stored[0]?.state).toBe("closed");
      expect(stored[0]?.prMergedAt).not.toBeNull();
    });

    /** @scenario "A redelivered announcement changes nothing" */
    it("leaves one unchanged pull request after a duplicate delivery", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi.fn(),
      });
      const payload = pullRequestDelivery({
        branch: "feat/redelivered",
        number: 81,
      });

      await deliver(mapping, payload);
      const first = await storedFor("feat/redelivered");
      await deliver(mapping, payload);
      const second = await storedFor("feat/redelivered");

      expect(second).toHaveLength(1);
      expect(second[0]?.prNumber).toBe(first[0]?.prNumber);
      expect(second[0]?.title).toBe(first[0]?.title);
      expect(second[0]?.state).toBe(first[0]?.state);
      expect(second[0]?.mappedAt.getTime()).toBe(first[0]?.mappedAt.getTime());
      const check = await branchCheckFor("feat/redelivered");
      expect(check?.attempts).toBe(0);
      expect(check?.recheckAfter).toBeNull();
    });

    it("never lowers a branch's stored pull-request count", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi
          .fn()
          .mockResolvedValue([
            apiPullRequest({ number: 91 }),
            apiPullRequest({ number: 92 }),
          ]),
      });
      await mapping.mapBranch({
        organizationId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/two-pulls",
      });
      expect((await branchCheckFor("feat/two-pulls"))?.prCount).toBe(2);

      // An announcement speaks for one pull request, not for the branch.
      await deliver(
        mapping,
        pullRequestDelivery({ branch: "feat/two-pulls", number: 91 }),
      );

      expect((await branchCheckFor("feat/two-pulls"))?.prCount).toBe(2);
    });

    /** @scenario "A branch whose announcement never arrived is still linked by the recheck" */
    it("is still linked by the sweep when no announcement is delivered at all", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValueOnce([]);
      const { mapping } = servicesWith({ listPullRequestsForHead });
      await mapping.mapBranch({
        organizationId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/missed-hook",
      });

      // The pull request is opened and the delivery never arrives, so only the
      // branch's backoff elapsing can find it.
      listPullRequestsForHead.mockResolvedValue([
        apiPullRequest({ number: 99 }),
      ]);
      await prisma.githubBranchPullRequestCheck.updateMany({
        where: { organizationId, headBranch: "feat/missed-hook" },
        data: { recheckAfter: new Date(Date.now() - 1000) },
      });

      await runBranchRecheckPass({ repository, mapping });

      expect(
        (await storedFor("feat/missed-hook")).map((r) => r.prNumber),
      ).toEqual([99]);
    });
  });

  describe("given deliveries that describe the same pull request out of order", () => {
    const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    /**
     * GitHub does not promise delivery order, and the two timestamps a late
     * delivery would clear are the ones session-to-pull-request attribution
     * reads: a resurrected row takes the sessions that ran after the pull
     * request closed and prices them under it.
     */
    /** @scenario "A late delivery about an earlier state does not roll the pull request back" */
    it("keeps a merged pull request merged when an older delivery arrives after it", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({ listPullRequestsForHead: vi.fn() });

      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/late-delivery",
          number: 101,
          action: "closed",
          state: "closed",
          mergedAt: TEN_MINUTES_AGO,
          closedAt: TEN_MINUTES_AGO,
          updatedAt: TEN_MINUTES_AGO,
        }),
      );

      // The edit GitHub sent an hour ago finally lands.
      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/late-delivery",
          number: 101,
          action: "edited",
          state: "open",
          title: "The title it had an hour ago",
          updatedAt: AN_HOUR_AGO,
        }),
      );

      const stored = await storedFor("feat/late-delivery");
      expect(stored).toHaveLength(1);
      expect(stored[0]?.state).toBe("closed");
      expect(stored[0]?.prMergedAt).not.toBeNull();
      expect(stored[0]?.prClosedAt).not.toBeNull();
      expect(stored[0]?.title).toBe("Link sessions to pull requests");
    });

    it("keeps a closed pull request closed when an older reopen arrives after it", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({ listPullRequestsForHead: vi.fn() });

      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/late-reopen",
          number: 102,
          action: "closed",
          state: "closed",
          closedAt: TEN_MINUTES_AGO,
          updatedAt: TEN_MINUTES_AGO,
        }),
      );

      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/late-reopen",
          number: 102,
          action: "reopened",
          state: "open",
          updatedAt: AN_HOUR_AGO,
        }),
      );

      const stored = await storedFor("feat/late-reopen");
      expect(stored[0]?.state).toBe("closed");
      expect(stored[0]?.prClosedAt).not.toBeNull();
    });

    /**
     * The same race with the other writer. A listing is asked for the branch,
     * and while it is in flight GitHub announces the merge, so the answer that
     * arrives describes a state that is already old.
     */
    /** @scenario "A listing that answers after a newer announcement does not roll it back" */
    it("keeps the announced state when a listing answers with an older one", async () => {
      await seedInstallation();
      let releaseListing: () => void = () => undefined;
      const inFlight = new Promise<void>((resolve) => {
        releaseListing = resolve;
      });
      const listPullRequestsForHead = vi.fn().mockImplementation(async () => {
        await inFlight;
        return [
          apiPullRequest({
            number: 103,
            htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/103`,
            state: "open",
            updatedAt: AN_HOUR_AGO,
          }),
        ];
      });
      const { mapping } = servicesWith({ listPullRequestsForHead });
      const target = {
        organizationId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/slow-listing",
      };

      const listing = mapping.mapBranch(target);
      // The merge is announced while the listing is still waiting on GitHub.
      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/slow-listing",
          number: 103,
          action: "closed",
          state: "closed",
          mergedAt: TEN_MINUTES_AGO,
          closedAt: TEN_MINUTES_AGO,
          updatedAt: TEN_MINUTES_AGO,
        }),
      );
      releaseListing();
      await listing;

      expect(listPullRequestsForHead).toHaveBeenCalledTimes(1);
      const stored = await storedFor("feat/slow-listing");
      expect(stored[0]?.state).toBe("closed");
      expect(stored[0]?.prMergedAt).not.toBeNull();
    });

    it("writes a redelivery whose update time equals the stored one", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({ listPullRequestsForHead: vi.fn() });
      const payload = pullRequestDelivery({
        branch: "feat/equal-times",
        number: 104,
        updatedAt: TEN_MINUTES_AGO,
      });

      await deliver(mapping, payload);
      // Drift the stored title, so a skipped write would be visible.
      await prisma.githubPullRequest.updateMany({
        where: { organizationId, prNumber: 104 },
        data: { title: "drifted" },
      });
      await deliver(mapping, payload);

      expect((await storedFor("feat/equal-times"))[0]?.title).toBe(
        "Link sessions to pull requests",
      );
    });

    it("accepts the next write for a row stored before the update time was kept", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({ listPullRequestsForHead: vi.fn() });
      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/no-stored-time",
          number: 105,
          updatedAt: TEN_MINUTES_AGO,
        }),
      );
      // A row written before the column existed carries no source timestamp.
      await prisma.githubPullRequest.updateMany({
        where: { organizationId, prNumber: 105 },
        data: { prUpdatedAt: null },
      });

      await deliver(
        mapping,
        pullRequestDelivery({
          branch: "feat/no-stored-time",
          number: 105,
          action: "closed",
          state: "closed",
          mergedAt: TEN_MINUTES_AGO,
          closedAt: TEN_MINUTES_AGO,
          updatedAt: TEN_MINUTES_AGO,
        }),
      );

      const stored = await storedFor("feat/no-stored-time");
      expect(stored[0]?.state).toBe("closed");
      // And it carries the timestamp from now on.
      expect(stored[0]?.prUpdatedAt).toEqual(new Date(TEN_MINUTES_AGO));
    });
  });

  describe("given a branch sitting on the longest backoff with no pull request", () => {
    /** @scenario "A new session on a branch brings its next question forward" */
    it("brings its next question forward when a session folds on it", async () => {
      await seedInstallation();
      const { mapping } = servicesWith({
        listPullRequestsForHead: vi.fn().mockResolvedValue([]),
      });
      const request = {
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/still-working",
      };
      await mapping.requestBranchMapping(request);
      await armLongestBackoff("feat/still-working");

      // A second session folds on the same branch.
      await mapping.requestBranchMapping(request);

      const check = await branchCheckFor("feat/still-working");
      expect(check?.recheckAfter?.getTime()).toBeGreaterThan(Date.now());
      expect(check?.recheckAfter?.getTime()).toBeLessThanOrEqual(
        Date.now() + 15 * 60 * 1000,
      );
      // Back to the start of the ladder, so the next empty answer waits
      // fifteen minutes rather than resuming near a day.
      expect(check?.attempts).toBe(0);
    });

    /** @scenario "Repeated folds on one branch still ask GitHub once per backoff" */
    it("still asks GitHub once however many sessions fold inside the window", async () => {
      await seedInstallation();
      const listPullRequestsForHead = vi.fn().mockResolvedValue([]);
      const { mapping } = servicesWith({ listPullRequestsForHead });
      const request = {
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${tag}`,
        repositoryName: "widgets",
        headBranch: "feat/busy",
      };

      await mapping.requestBranchMapping(request);
      await mapping.requestBranchMapping(request);
      await mapping.requestBranchMapping(request);

      expect(listPullRequestsForHead).toHaveBeenCalledTimes(1);
    });
  });
});
