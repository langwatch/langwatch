/**
 * @vitest-environment node
 * @integration
 *
 * The pull-request usage rollup end to end: mapped pull requests in Postgres,
 * session rows in ClickHouse, and the caller's real RBAC deciding which
 * projects appear and which of them carry money.
 *
 * The permission cuts, and the names each project appears under, are resolved
 * through `resolveCallerProjectScope`, the very function both read surfaces
 * call, against RoleBindings seeded in Postgres. That is the point: a test that
 * handed the service a project list it wrote itself would prove nothing about
 * who can actually see what.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { Permission } from "~/server/api/rbac";
import { prisma } from "~/server/db";
import type { CodingAgentSessionEventRecord } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSessionEvents.mapProjection";
import {
  type CallerProjectScope,
  resolveCallerProjectScope,
} from "~/server/organizations/resolveCallerProjectScope";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { codingAgentSessionRow } from "../../github/__tests__/codingAgentSessionRowFixture";
import { PrismaGithubPullRequestsRepository } from "../../github/repositories/github-pull-requests.prisma.repository";
import { PullRequestUsageService } from "../pull-request-usage.service";
import { CodingAgentSessionClickHouseRepository } from "../repositories/coding-agent-session.clickhouse.repository";
import { CodingAgentSessionEventsClickHouseRepository } from "../repositories/coding-agent-session-events.repository";

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
let mixedCaseProjectId: string;

const pullRequests = new PrismaGithubPullRequestsRepository(prisma);
let sessions: CodingAgentSessionClickHouseRepository;
let sessionEvents: CodingAgentSessionEventsClickHouseRepository;
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

/** The caller's own cut, resolved by the very function both read surfaces call. */
async function callerScope(): Promise<CallerProjectScope> {
  return resolveCallerProjectScope({ userId, organizationId, prisma });
}

/**
 * That same cut, narrowed to one project, for the cases that are about the
 * rollup rather than about who may see what. The names come from the resolver
 * either way, so a row is named here the way the page names it.
 */
async function scopedTo(projectId: string) {
  const { projects } = await callerScope();
  return {
    permittedProjectIds: [projectId],
    costProjectIds: [projectId],
    projects,
  };
}

async function seedSession({
  projectId,
  sessionId,
  startedAtMs,
  costUsd,
  repositoryHost = "github.com",
  repositoryOwner = OWNER,
  repositoryName = "widgets",
}: {
  projectId: string;
  sessionId: string;
  startedAtMs: number;
  costUsd: number;
  /** The remote as the agent reported it, casing and all. */
  repositoryHost?: string;
  repositoryOwner?: string;
  repositoryName?: string;
}): Promise<void> {
  await sessions.upsert(
    codingAgentSessionRow({
      tenantId: projectId,
      sessionId,
      startedAtMs,
      repositoryHost,
      repositoryOwner,
      repositoryName,
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

/** One model call on the per-call fact table, filled in around the essentials. */
function modelCallEvent({
  tenantId,
  sessionId,
  recordId,
  model,
  costUsd,
}: {
  tenantId: string;
  sessionId: string;
  recordId: string;
  model: string;
  costUsd: number;
}): CodingAgentSessionEventRecord {
  return {
    tenantId,
    sessionId,
    timeUnixMs: Date.now() - HOUR,
    recordId,
    eventKind: "model_call",
    agent: "claude_code",
    sessionKeySource: "provider",
    traceId: "",
    spanId: "",
    promptId: "",
    querySource: "repl_main_thread",
    agentType: "",
    eventSequence: 1,
    requestId: recordId.slice(0, 8),
    model,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheCreationTokens: 10,
    costUsd,
    durationMs: 100,
    ttftMs: 0,
    attempt: 0,
    speed: "standard",
    stopReason: "end_turn",
    preTokens: 0,
    postTokens: 0,
    compactionTrigger: "",
    precomputeReuse: "",
    statusCode: "",
    errorType: "",
    rateLimitCarrier: "",
    retryDurationMs: 0,
    toolName: "",
    success: "",
    decision: "",
    decisionSource: "",
    toolInputBytes: 0,
    toolResultBytes: 0,
    promptChars: 0,
    totalTokens: 0,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  sessions = new CodingAgentSessionClickHouseRepository(async () => ch);
  sessionEvents = new CodingAgentSessionEventsClickHouseRepository(
    async () => ch,
  );

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
  mixedCaseProjectId = await makeProject("mixed-case");

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
        prUpdatedAt: new Date(Date.now() - 5 * HOUR),
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
  // The same remote, reported the way a git remote actually writes it. The
  // mapping stores host and repository lowercased; the session stores whatever
  // the agent read off the remote.
  await seedSession({
    projectId: mixedCaseProjectId,
    sessionId: `${tag}-mixed-case`,
    startedAtMs: Date.now() - 6 * HOUR,
    costUsd: 3.25,
    repositoryHost: "GitHub.com",
    repositoryOwner: OWNER.toUpperCase(),
    repositoryName: "Widgets",
  });

  // Per-call rows for the two visible sessions: two models, so the breakdown
  // has something to split.
  await sessionEvents.ensure([
    modelCallEvent({
      tenantId: visibleProjectId,
      sessionId: `${tag}-visible-1`,
      recordId: "1".repeat(64),
      model: "claude-fable-5",
      costUsd: 1.5,
    }),
    modelCallEvent({
      tenantId: visibleProjectId,
      sessionId: `${tag}-visible-2`,
      recordId: "2".repeat(64),
      model: "gpt-5-mini",
      costUsd: 2.5,
    }),
  ]);

  service = new PullRequestUsageService({
    pullRequests,
    sessions,
    personalSessions: {
      listRecent: async () => [],
    },
    sessionEvents,
    installations: { coversRepository: async () => true },
    resolveOrganizationId: async () => organizationId,
    // Claude Code on a bundled plan; everything else is billed per token. The
    // real policy reads the organization's catalog, which this suite does not
    // seed; what matters here is that the split reaches rows and totals.
    isSourceNonBillable: async ({ sourceType }) => sourceType === "claude_code",
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const projectId of [
      visibleProjectId,
      tokensOnlyProjectId,
      hiddenProjectId,
      mixedCaseProjectId,
    ]) {
      if (!projectId) continue;
      await ch.exec({
        query:
          "ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: projectId },
      });
      await ch.exec({
        query:
          "ALTER TABLE coding_agent_session_events DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: projectId },
      });
    }
  }
  if (organizationId) {
    await cleanupTestRows(prisma, [
      ["githubPullRequest", { organizationId }],
      ["roleBinding", { organizationId }],
      ["customRole", { organizationId }],
      ["organizationUser", { organizationId }],
      ["project", { teamId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
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
    /** @scenario "The page rolls up tokens and cost per pull request" */
    it("reports the sessions count, tokens and assistant cost over the whole lifetime", async () => {
      const usage = await service.getPullRequestUsage({
        ...query(),
        ...(await scopedTo(visibleProjectId)),
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
      // A shared project speaks for the work that ran in it, by its own name.
      expect(usage.rows[0]?.contributorLabel).toBe(`visible-${tag}`);
      expect(usage.rows[0]?.contributorIsProject).toBe(true);
      expect(usage.rows[0]?.agent).toBe("claude_code");
      expect(usage.rows[0]?.models).toEqual(["claude-fable-5"]);
      // Seeded with a title on every session; none of it reaches the reader.
      expect(JSON.stringify(usage)).not.toContain("a title the response");
    });

    /** @scenario "The organization-wide read carries the cost split and the per-model totals" */
    it("carries the billed and not billed halves, the per-model totals, and no title", async () => {
      const usage = await service.getPullRequestUsage({
        ...query(),
        ...(await scopedTo(visibleProjectId)),
      });

      // Claude Code is the bundled assistant here, so the whole list price is
      // theoretical rather than spend.
      expect(usage.totals.nonBilledCostUsd).toBeCloseTo(4.0);
      expect(usage.totals.billedCostUsd).toBe(0);
      expect(usage.rows[0]?.nonBilledCostUsd).toBeCloseTo(4.0);
      expect(usage.rows[0]?.billedCostUsd).toBe(0);

      expect(usage.modelBreakdown.map((model) => model.model).sort()).toEqual([
        "claude-fable-5",
        "gpt-5-mini",
      ]);
      expect(
        usage.modelBreakdown.every((model) => model.totalTokens === 180),
      ).toBe(true);

      // The mapping stores the pull request's own GitHub title; this response
      // never carries it.
      expect(JSON.stringify(usage)).not.toContain(
        "Link sessions to pull requests",
      );
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

  describe("given a session whose remote was reported with the host's own casing", () => {
    /** @scenario "The page rolls up tokens and cost per pull request" */
    it("rolls it up all the same", async () => {
      const usage = await service.getPullRequestUsage({
        ...query(),
        ...(await scopedTo(mixedCaseProjectId)),
      });

      expect(usage.totals.sessionsCount).toBe(1);
      expect(usage.totals.costUsd).toBeCloseTo(3.25);
      expect(usage.rows[0]?.projectId).toBe(mixedCaseProjectId);
    });
  });

  // `host` is a public query parameter on the REST read, and the mapping is
  // addressed by (organization, host, repository, number). Folding only the
  // repository half of that key answers "we do not know this pull request" for
  // a spelling of the host that names the very row we hold.
  describe("given a caller who names the host with its own casing", () => {
    /** @scenario "One repository reported with two host spellings stays one repository" */
    it("resolves the same mapping", async () => {
      const usage = await service.getPullRequestUsage({
        ...query(),
        repositoryHost: "GitHub.com",
        repositoryFullName: REPO_FULL_NAME.toUpperCase(),
        ...(await scopedTo(visibleProjectId)),
      });

      expect(usage.pullRequest.prNumber).toBe(PR_NUMBER);
      expect(usage.totals.sessionsCount).toBe(2);
    });
  });

  describe("given a repository and pull request number no mapping knows", () => {
    /** @scenario "An unmapped pull request returns the named failure" */
    it("returns the pull request not mapped failure", async () => {
      const failure = await service
        .getPullRequestUsage({
          ...query(),
          prNumber: 9999,
          ...(await scopedTo(visibleProjectId)),
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HandledError);
      // Asserted on the code, never the prose: the message is copy.
      expect((failure as HandledError).code).toBe("github_pr_not_mapped");
    });
  });
});
