/**
 * @vitest-environment node
 * @integration
 *
 * The pull-request usage rollup end to end: mapped pull requests in Postgres,
 * session rows in ClickHouse, and the caller's real RBAC deciding which
 * projects appear and which of them carry money.
 *
 * The permission cuts are resolved through `batchScopePermissions`, the same
 * helper the REST endpoint calls, against RoleBindings seeded in Postgres. That
 * is the point: a test that handed the service a project list it wrote itself
 * would prove nothing about who can actually see what.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { HandledError } from "@langwatch/handled-error";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batchScopePermissions, type Permission } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { codingAgentSessionRow } from "../../github/__tests__/codingAgentSessionRowFixture";
import { PrismaGithubPullRequestsRepository } from "../../github/repositories/github-pull-requests.prisma.repository";
import { PullRequestUsageService } from "../pull-request-usage.service";
import { CodingAgentSessionClickHouseRepository } from "../repositories/coding-agent-session.clickhouse.repository";

const tag = nanoid(8);
const OWNER = `acme-${tag}`;
const REPO_FULL_NAME = `${OWNER}/widgets`;
const BRANCH = "feat/linkage";
const PR_NUMBER = 41;
const HOUR = 60 * 60 * 1000;

let ch: ClickHouseClient;
let organizationId: string;
let teamId: string;
let userId: string;
/** Sessions land here and the caller may both read and price it. */
let visibleProjectId: string;
/** The caller may read it, but not its costs. */
let tokensOnlyProjectId: string;
/** The caller may not read it at all. */
let hiddenProjectId: string;

const pullRequests = new PrismaGithubPullRequestsRepository(prisma);
let sessions: CodingAgentSessionClickHouseRepository;
let service: PullRequestUsageService;

async function makeProject(name: string): Promise<string> {
  const project = await prisma.project.create({
    data: {
      name: `${name}-${tag}`,
      slug: `${name}-${tag}`,
      apiKey: `${name}-${tag}`,
      teamId,
      language: "typescript",
      framework: "other",
    },
  });
  return project.id;
}

/** A project-scoped binding carrying exactly `permissions`. */
async function grant({
  projectId,
  permissions,
  name,
}: {
  projectId: string;
  permissions: Permission[];
  name: string;
}): Promise<void> {
  const customRole = await prisma.customRole.create({
    data: {
      organizationId,
      name: `${name}-${tag}`,
      permissions,
    },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId,
      role: TeamUserRole.CUSTOM,
      customRoleId: customRole.id,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: projectId,
    },
  });
}

/** The caller's own permitted / priceable split, resolved the way REST does. */
async function callerScope(): Promise<{
  permittedProjectIds: string[];
  costProjectIds: string[];
}> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId }, archivedAt: null },
    select: { id: true, teamId: true },
  });
  const ctx = {
    prisma,
    session: { user: { id: userId }, expires: "" } satisfies Session,
  };
  const args = {
    organizationId,
    teamIds: [],
    projectIds: projects.map((p) => p.id),
    projectTeamId: Object.fromEntries(projects.map((p) => [p.id, p.teamId])),
  };
  const [viewable, priceable] = await Promise.all([
    batchScopePermissions(ctx, { ...args, permission: "traces:view" }),
    batchScopePermissions(ctx, { ...args, permission: "cost:view" }),
  ]);
  const permittedProjectIds = projects
    .map((p) => p.id)
    .filter((id) => viewable.projects.get(id) === true);
  return {
    permittedProjectIds,
    costProjectIds: permittedProjectIds.filter(
      (id) => priceable.projects.get(id) === true,
    ),
  };
}

async function seedSession({
  projectId,
  sessionId,
  startedAtMs,
  costUsd,
}: {
  projectId: string;
  sessionId: string;
  startedAtMs: number;
  costUsd: number;
}): Promise<void> {
  await sessions.upsert(
    codingAgentSessionRow({
      tenantId: projectId,
      sessionId,
      startedAtMs,
      repositoryHost: "github.com",
      repositoryOwner: OWNER,
      repositoryName: "widgets",
      gitBranch: BRANCH,
      title: "a title the response must never carry",
      userId: "agent-user-1",
      agent: "claude_code",
      models: ["claude-fable-5"],
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      costUsd,
    }),
  );
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  sessions = new CodingAgentSessionClickHouseRepository(async () => ch);

  const organization = await prisma.organization.create({
    data: { name: `pr-usage-${tag}`, slug: `pr-usage-${tag}` },
  });
  organizationId = organization.id;
  const team = await prisma.team.create({
    data: { name: `pr-usage-${tag}`, slug: `pr-usage-${tag}`, organizationId },
  });
  teamId = team.id;

  const user = await prisma.user.create({
    data: { email: `pr-usage-${tag}@example.com`, name: `pr-usage-${tag}` },
  });
  userId = user.id;
  // A member of the org with no org-wide grant: every project this caller can
  // reach is reached through a project-scoped binding below.
  await prisma.organizationUser.create({
    data: { userId, organizationId, role: OrganizationUserRole.MEMBER },
  });

  visibleProjectId = await makeProject("visible");
  tokensOnlyProjectId = await makeProject("tokens-only");
  hiddenProjectId = await makeProject("hidden");

  await grant({
    projectId: visibleProjectId,
    permissions: ["traces:view", "cost:view"],
    name: "reader-pricer",
  });
  await grant({
    projectId: tokensOnlyProjectId,
    permissions: ["traces:view"],
    name: "reader-only",
  });
  // hiddenProjectId gets no binding at all.

  await pullRequests.upsertPullRequests({
    pullRequests: [
      {
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName: REPO_FULL_NAME,
        headBranch: BRANCH,
        prNumber: PR_NUMBER,
        htmlUrl: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
        title: "Link sessions to pull requests",
        state: "open",
        isDraft: false,
        authorLogin: "someone",
        prCreatedAt: new Date(Date.now() - 5 * HOUR),
        prClosedAt: null,
        prMergedAt: null,
      },
    ],
  });

  await seedSession({
    projectId: visibleProjectId,
    sessionId: `${tag}-visible-1`,
    startedAtMs: Date.now() - 8 * HOUR,
    costUsd: 1.5,
  });
  await seedSession({
    projectId: visibleProjectId,
    sessionId: `${tag}-visible-2`,
    startedAtMs: Date.now() - 2 * HOUR,
    costUsd: 2.5,
  });
  await seedSession({
    projectId: tokensOnlyProjectId,
    sessionId: `${tag}-tokens-only`,
    startedAtMs: Date.now() - 3 * HOUR,
    costUsd: 9.99,
  });
  await seedSession({
    projectId: hiddenProjectId,
    sessionId: `${tag}-hidden`,
    startedAtMs: Date.now() - 4 * HOUR,
    costUsd: 100,
  });

  service = new PullRequestUsageService({
    pullRequests,
    sessions,
    personalSessions: {
      listRecent: async () => [],
    },
    installations: { coversRepository: async () => true },
    resolveOrganizationId: async () => organizationId,
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const projectId of [
      visibleProjectId,
      tokensOnlyProjectId,
      hiddenProjectId,
    ]) {
      if (!projectId) continue;
      await ch.exec({
        query:
          "ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: projectId },
      });
    }
  }
  if (organizationId) {
    await prisma.githubPullRequest.deleteMany({ where: { organizationId } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.customRole.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await stopTestContainers();
});

const query = () => ({
  organizationId,
  repositoryHost: "github.com",
  repositoryFullName: REPO_FULL_NAME,
  prNumber: PR_NUMBER,
});

describe("pull request usage", () => {
  describe("given mapped pull requests with sessions attached across their lifetimes", () => {
    /** @scenario "The page rolls up sessions, tokens and cost per pull request" */
    it("reports the sessions count, tokens and assistant cost over the whole lifetime", async () => {
      const usage = await service.getPullRequestUsage({
        ...query(),
        permittedProjectIds: [visibleProjectId],
        costProjectIds: [visibleProjectId],
      });

      // Both sessions count, including the one that ran three hours BEFORE the
      // pull request was opened: the figures cover its lifetime, not a picker.
      expect(usage.totals.sessionsCount).toBe(2);
      expect(usage.totals.totalTokens).toBe(2 * 180);
      expect(usage.totals.costUsd).toBeCloseTo(4.0);
      expect(usage.pullRequest.prNumber).toBe(PR_NUMBER);
      expect(usage.pullRequest.headBranch).toBe(BRANCH);
      expect(usage.rows).toHaveLength(1);
      expect(usage.rows[0]?.projectId).toBe(visibleProjectId);
      expect(usage.rows[0]?.agent).toBe("claude_code");
      expect(usage.rows[0]?.models).toEqual(["claude-fable-5"]);
      // Seeded with a title on every session; none of it reaches the reader.
      expect(JSON.stringify(usage)).not.toContain("a title the response");
    });
  });

  describe("given sessions for one pull request across two projects", () => {
    /** @scenario "Cross-project totals include only projects the caller can view" */
    it("shows only the permitted projects' rows, and totals them alone", async () => {
      const scope = await callerScope();
      // The caller's real bindings: two readable projects, one invisible.
      expect(scope.permittedProjectIds.sort()).toEqual(
        [visibleProjectId, tokensOnlyProjectId].sort(),
      );
      expect(scope.permittedProjectIds).not.toContain(hiddenProjectId);

      const usage = await service.getPullRequestUsage({
        ...query(),
        ...scope,
      });

      expect(usage.rows.map((row) => row.projectId).sort()).toEqual(
        [visibleProjectId, tokensOnlyProjectId].sort(),
      );
      // Three sessions, not four: the hidden project's never appears, and its
      // hundred dollars never lands in the total.
      expect(usage.totals.sessionsCount).toBe(3);
      expect(usage.totals.costUsd).toBeCloseTo(4.0);
    });
  });

  describe("given a project where the caller may view traces but not costs", () => {
    /** @scenario "A project without the cost permission returns tokens with no cost" */
    it("returns that project's tokens with its cost absent", async () => {
      const scope = await callerScope();
      expect(scope.costProjectIds).toEqual([visibleProjectId]);

      const usage = await service.getPullRequestUsage({
        ...query(),
        ...scope,
      });

      const tokensOnlyRow = usage.rows.find(
        (row) => row.projectId === tokensOnlyProjectId,
      );
      expect(tokensOnlyRow?.totalTokens).toBe(180);
      expect(tokensOnlyRow?.costUsd).toBeNull();

      const pricedRow = usage.rows.find(
        (row) => row.projectId === visibleProjectId,
      );
      expect(pricedRow?.costUsd).toBeCloseTo(4.0);
    });
  });

  describe("given a repository and pull request number no mapping knows", () => {
    /** @scenario "An unmapped pull request returns the named failure" */
    it("returns the pull request not mapped failure", async () => {
      const failure = await service
        .getPullRequestUsage({
          ...query(),
          prNumber: 9999,
          permittedProjectIds: [visibleProjectId],
          costProjectIds: [visibleProjectId],
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HandledError);
      // Asserted on the code, never the prose: the message is copy.
      expect((failure as HandledError).code).toBe("github_pr_not_mapped");
    });
  });
});
