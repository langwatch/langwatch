import type {
  CodingAgentSessionBranchRecord,
  CodingAgentSessionContextUsage,
} from "@langwatch/coding-agent-contract";
import {
  GithubPullRequestNotMappedError,
  type GithubPullRequest,
} from "@langwatch/github-contract";
import { describe, expect, it } from "vitest";

import {
  TEST_NOW_MS,
  TestBillingPolicy,
  TestClock,
  TestEvents,
  TestGithubService,
  TestMetricSeries,
  TestProjectService,
  TestSessions,
  TestTraceSessions,
  branchSession,
  pullRequest,
} from "../../__tests__/fixtures/coding-agent.fixture.ts";
import { MAX_USAGE_CONTEXTS } from "../../eventing/coding-agent-session-state.projection.ts";
import { USAGE_SESSION_WINDOW_MS } from "../coding-agent-pull-request-read.service.ts";
import { CodingAgentFeatureService } from "../coding-agent.service.ts";

function serviceWith(input: {
  sessions: TestSessions;
  github: TestGithubService;
  events?: TestEvents;
  billing?: TestBillingPolicy;
}) {
  return CodingAgentFeatureService.create({
    sessions: input.sessions,
    traceSessions: new TestTraceSessions(),
    metricSeries: new TestMetricSeries(),
    sessionEvents: input.events ?? new TestEvents(),
    github: input.github,
    projects: new TestProjectService(),
    billing: input.billing ?? new TestBillingPolicy(),
    clock: new TestClock(),
  });
}

const query = {
  organizationId: "organization-1",
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 8,
  permittedProjectIds: ["project-1", "project-2"],
  costProjectIds: ["project-1"],
  projects: {
    "project-1": { slug: "personal", contributorLabel: "Ada", isLinkable: false },
    "project-2": { slug: "shared", contributorLabel: "Shared", isLinkable: true },
  },
};

describe("Coding Agent pull-request usage", () => {
  /** @scenario "A project without the cost permission returns tokens with no cost" */
  /** @scenario "The organization-wide read carries the cost split and the per-model totals" */
  /** @scenario "The page rolls up tokens and cost per pull request" */
  it("leaves post-merge sessions out and preserves nullable price and billed splits", async () => {
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "feature",
        prNumber: query.prNumber,
        prCreatedAt: new Date(TEST_NOW_MS - 10 * 24 * 60 * 60 * 1000),
        prClosedAt: new Date(TEST_NOW_MS - 24 * 60 * 60 * 1000),
        prMergedAt: new Date(TEST_NOW_MS - 24 * 60 * 60 * 1000),
        title: "Ship it",
      }),
    ];
    const sessions = new TestSessions();
    sessions.branchRows = [
      branchSession({
        sessionId: "in-pr",
        tenantId: "project-1",
        gitBranch: "feature",
        gitBranches: ["feature", "later-branch"],
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
        costUsd: 1.5,
        agent: "claude_code",
        models: ["claude-3"],
        startedAtMs: TEST_NOW_MS - 2 * 24 * 60 * 60 * 1000,
      }),
      branchSession({
        sessionId: "unpriced",
        tenantId: "project-2",
        gitBranch: "feature",
        inputTokens: 1,
        outputTokens: 2,
        costUsd: 9,
        agent: "copilot",
        models: ["gpt-4"],
        startedAtMs: TEST_NOW_MS - 2 * 24 * 60 * 60 * 1000,
      }),
      branchSession({
        sessionId: "after-merge",
        tenantId: "project-1",
        gitBranch: "feature",
        startedAtMs: TEST_NOW_MS - 60_000,
        inputTokens: 999,
      }),
    ];
    const events = new TestEvents();
    events.modelTotals = [
      {
        tenantId: "project-1",
        sessionId: "in-pr",
        model: "claude-3",
        repositoryHost: "",
        repositoryOwner: "",
        repositoryName: "",
        branch: "",
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
        costUsd: 1.5,
      },
      {
        tenantId: "project-2",
        sessionId: "unpriced",
        model: "gpt-4",
        repositoryHost: "",
        repositoryOwner: "",
        repositoryName: "",
        branch: "",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 9,
      },
    ];
    const billing = new TestBillingPolicy();
    billing.nonBillableAgents.add("claude_code");
    const service = serviceWith({ sessions, github, events, billing });

    const result = await service.getPullRequestUsage(query);

    expect(sessions.branchInputs).toEqual([
      expect.objectContaining({
        tenantIds: ["project-1", "project-2"],
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        branches: ["feature"],
        startedAtFromMs: TEST_NOW_MS - USAGE_SESSION_WINDOW_MS,
      }),
    ]);
    expect(result.pullRequest).toMatchObject({ prNumber: 8, headBranch: "feature" });
    expect(result.rows).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        contributorLabel: "Ada",
        contributorIsProject: false,
        sessionsCount: 1,
        totalTokens: 100,
        costUsd: 1.5,
        billedCostUsd: 0,
        nonBilledCostUsd: 1.5,
      }),
      expect.objectContaining({
        projectId: "project-2",
        contributorLabel: "Shared",
        contributorIsProject: true,
        sessionsCount: 1,
        totalTokens: 3,
        costUsd: null,
        billedCostUsd: null,
        nonBilledCostUsd: null,
      }),
    ]);
    expect(result.totals).toMatchObject({
      sessionsCount: 2,
      totalTokens: 103,
      costUsd: 1.5,
    });
    expect(result.modelBreakdown).toEqual([
      expect.objectContaining({
        model: "claude-3",
        totalTokens: 100,
        costUsd: 1.5,
        tokensKnown: true,
      }),
      expect.objectContaining({
        model: "gpt-4",
        totalTokens: 3,
        costUsd: null,
        tokensKnown: true,
      }),
    ]);
    // Every candidate the repository read returned, not only the ones the
    // tenure rule attaches: the proportional split needs a session's WHOLE
    // event history to size the share, including the tokens it spent
    // elsewhere, so the fact read runs before attribution rather than after.
    expect(events.modelTotalInputs).toEqual([
      {
        tenantIds: ["project-1", "project-2"],
        sessionIds: ["in-pr", "unpriced", "after-merge"],
        fromMs: TEST_NOW_MS - USAGE_SESSION_WINDOW_MS,
      },
    ]);
  });

  it("assigns a multi-branch session to the earliest eligible pull request, not only its final branch", async () => {
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "first",
        prNumber: 8,
      }),
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "last",
        prNumber: 9,
        prCreatedAt: new Date(TEST_NOW_MS - 30_000),
      }),
    ];
    const sessions = new TestSessions();
    sessions.branchRows = [
      branchSession({
        sessionId: "both",
        gitBranch: "last",
        gitBranches: ["first", "last"],
        startedAtMs: TEST_NOW_MS - 1_000,
        inputTokens: 5,
      }),
    ];
    const service = serviceWith({ sessions, github });

    const result = await service.getPullRequestUsage(query);

    expect(result.totals.totalTokens).toBe(5);
  });

  /** @scenario "Cross-project totals include only projects the caller can view" */
  it("returns the mapped identity with empty, nullable totals when the caller cannot view a project", async () => {
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "feature",
        prNumber: 8,
      }),
    ];
    const sessions = new TestSessions();
    const service = serviceWith({ sessions, github });

    const result = await service.getPullRequestUsage({
      ...query,
      permittedProjectIds: [],
      costProjectIds: [],
    });

    expect(sessions.branchInputs).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({
      sessionsCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: null,
      billedCostUsd: null,
      nonBilledCostUsd: null,
    });
  });

  it("reports session models when per-call event totals are unavailable and preserves descending session detail titles", async () => {
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "feature",
        prNumber: 8,
      }),
    ];
    const sessions = new TestSessions();
    sessions.branchRows = [
      branchSession({
        sessionId: "older",
        gitBranch: "feature",
        startedAtMs: TEST_NOW_MS - 10_000,
        title: "",
        models: ["claude-3"],
        inputTokens: 1,
      }),
      branchSession({
        sessionId: "newer",
        gitBranch: "feature",
        startedAtMs: TEST_NOW_MS - 1_000,
        title: "Review",
        models: ["gpt-4"],
        inputTokens: 2,
      }),
    ];
    const service = serviceWith({ sessions, github });

    const detail = await service.getPullRequestDetail(query);

    expect(detail.modelBreakdown).toEqual([
      expect.objectContaining({ model: "claude-3", tokensKnown: false, totalTokens: 0 }),
      expect.objectContaining({ model: "gpt-4", tokensKnown: false, totalTokens: 0 }),
    ]);
    expect(detail.sessions).toEqual([
      expect.objectContaining({ sessionId: "newer", title: "Review", totalTokens: 2 }),
      expect.objectContaining({ sessionId: "older", title: null, totalTokens: 1 }),
    ]);
  });

  /** @scenario "An unmapped pull request returns the named failure" */
  it("raises the GitHub contract error when no mapped pull request exists", async () => {
    const service = serviceWith({
      sessions: new TestSessions(),
      github: new TestGithubService(),
    });

    await expect(service.getPullRequestUsage(query)).rejects.toBeInstanceOf(
      GithubPullRequestNotMappedError,
    );
  });
});

/**
 * The session row's per-context record as the split's first source — it
 * covers the span-only agents the fact table never sees.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
describe("Coding Agent pull-request usage from the session's per-context record", () => {
  const LINKAGE_PR = 7;
  const NEXT_PR = 8;

  function twoPullRequests(): GithubPullRequest[] {
    return [
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "feat/linkage",
        prNumber: LINKAGE_PR,
        prCreatedAt: new Date(TEST_NOW_MS - 12 * 60 * 60 * 1000),
      }),
      pullRequest({
        repositoryFullName: query.repositoryFullName,
        headBranch: "feat/next",
        prNumber: NEXT_PR,
        prCreatedAt: new Date(TEST_NOW_MS - 8 * 60 * 60 * 1000),
      }),
    ];
  }

  /** One recorded context on the mapping's own repository. */
  function recorded(
    branch: string,
    over: Partial<CodingAgentSessionContextUsage> = {},
  ): CodingAgentSessionContextUsage {
    return {
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      branch,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      ...over,
    };
  }

  function serviceFor(session: CodingAgentSessionBranchRecord, events?: TestEvents) {
    const github = new TestGithubService();
    github.pullRequests = twoPullRequests();
    const sessions = new TestSessions();
    sessions.branchRows = [session];
    return { service: serviceWith({ sessions, github, events }), github };
  }

  function longLivedSession(
    over: Partial<CodingAgentSessionBranchRecord> = {},
  ): CodingAgentSessionBranchRecord {
    return branchSession({
      sessionId: "span-only",
      tenantId: "project-1",
      agent: "codex",
      gitBranch: "feat/next",
      gitBranches: ["feat/linkage", "feat/next"],
      startedAtMs: TEST_NOW_MS - 6 * 60 * 60 * 1000,
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 10,
      ...over,
    });
  }

  /** @scenario "A session's usage recorded per declared context splits by that record" */
  it("prices each pull request by what the row recorded under its branch", async () => {
    const session = longLivedSession({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
      cacheCreationTokens: 8,
      costUsd: 2,
      usageByContext: [
        recorded("feat/linkage", {
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 5,
          cacheCreationTokens: 2,
          costUsd: 0.5,
        }),
        recorded("feat/next", {
          inputTokens: 75,
          outputTokens: 30,
          cacheReadTokens: 15,
          cacheCreationTokens: 6,
          costUsd: 1.5,
        }),
      ],
    });

    const first = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session).service.getPullRequestUsage(query);

    expect(first.totals.inputTokens).toBe(25);
    expect(first.totals.outputTokens).toBe(10);
    expect(first.totals.cacheReadTokens).toBe(5);
    expect(first.totals.cacheCreationTokens).toBe(2);
    expect(first.totals.costUsd).toBeCloseTo(0.5, 10);
    expect(second.totals.inputTokens).toBe(75);
    expect(second.totals.costUsd).toBeCloseTo(1.5, 10);
  });

  /** @scenario "Usage from before the session declared anything follows its first declared branch" */
  it("charges each pull request its own declaration, and the rest to the first branch", async () => {
    const session = longLivedSession({
      usageByContext: [
        recorded("feat/linkage", { inputTokens: 10, costUsd: 0.1 }),
        recorded("feat/next", { inputTokens: 30, costUsd: 0.3 }),
      ],
    });

    const first = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session).service.getPullRequestUsage(query);

    expect(second.totals.inputTokens).toBe(30);
    expect(second.totals.costUsd).toBeCloseTo(0.3, 10);
    expect(first.totals.inputTokens).toBe(970);
    expect(first.totals.costUsd).toBeCloseTo(9.7, 10);
  });

  /** @scenario "Undeclared usage of a session that started on a branch with no pull request is priced nowhere" */
  it("reports only what was spent under the pull request's own declaration", async () => {
    const session = longLivedSession({
      gitBranches: ["main", "feat/next"],
      usageByContext: [recorded("feat/next", { inputTokens: 30, costUsd: 0.3 })],
    });

    const usage = await serviceFor(session).service.getPullRequestUsage(query);

    expect(usage.totals.sessionsCount).toBe(1);
    expect(usage.totals.inputTokens).toBe(30);
    expect(usage.totals.costUsd).toBeCloseTo(0.3, 10);
  });

  /** @scenario "Undeclared usage of a session that began in another repository is priced nowhere here" */
  it("leaves undeclared usage of a session that began elsewhere unowned here", async () => {
    // The row keeps one repository beside a branch set that is never reset, so
    // the branch names alone cannot say that feat/linkage was another
    // repository's branch — and it is this repository's pull request 7's head.
    const session = longLivedSession({
      usageByContext: [
        {
          ...recorded("feat/linkage", { inputTokens: 10, costUsd: 0.1 }),
          repositoryOwner: "other",
          repositoryName: "tools",
        },
        recorded("feat/next", { inputTokens: 30, costUsd: 0.3 }),
      ],
    });

    const first = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session).service.getPullRequestUsage(query);

    expect(first.totals.sessionsCount).toBe(0);
    expect(first.totals.inputTokens).toBe(0);
    expect(second.totals.inputTokens).toBe(30);
    expect(second.totals.costUsd).toBeCloseTo(0.3, 10);
  });

  /** @scenario "A branch name worked in two repositories follows whichever declared it first" */
  it("keeps the undeclared usage behind the repository that declared the name first", async () => {
    const session = longLivedSession({
      usageByContext: [
        {
          ...recorded("feat/linkage", { inputTokens: 10, costUsd: 0.1 }),
          repositoryOwner: "other",
          repositoryName: "tools",
        },
        recorded("feat/linkage", { inputTokens: 20, costUsd: 0.2 }),
        recorded("feat/next", { inputTokens: 30, costUsd: 0.3 }),
      ],
    });

    const first = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session).service.getPullRequestUsage(query);

    // Pull request 7 still earns what was spent on ITS feat/linkage, and
    // nothing of what the session spent before declaring anything.
    expect(first.totals.inputTokens).toBe(20);
    expect(first.totals.costUsd).toBeCloseTo(0.2, 10);
    expect(second.totals.inputTokens).toBe(30);
    expect(second.totals.costUsd).toBeCloseTo(0.3, 10);
  });

  /** @scenario "Usage a saturated record could not place is charged to no pull request" */
  it("charges each pull request its own branch and the unplaceable usage to neither", async () => {
    const session = longLivedSession({
      usageByContext: [
        recorded("feat/linkage", { inputTokens: 10, costUsd: 0.1 }),
        recorded("feat/next", { inputTokens: 30, costUsd: 0.3 }),
        ...Array.from({ length: MAX_USAGE_CONTEXTS - 2 }, (_unused, index) =>
          recorded(`feat/filler-${index}`, { inputTokens: 1, costUsd: 0.01 }),
        ),
      ],
    });

    const first = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session).service.getPullRequestUsage(query);

    expect(first.totals.inputTokens).toBe(10);
    expect(first.totals.costUsd).toBeCloseTo(0.1, 10);
    expect(second.totals.inputTokens).toBe(30);
    expect(second.totals.costUsd).toBeCloseTo(0.3, 10);
  });

  /** @scenario "A session that declared one branch for its whole life keeps its whole total" */
  it("reports the session's whole totals", async () => {
    const session = longLivedSession({
      gitBranch: "feat/linkage",
      gitBranches: ["feat/linkage"],
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      costUsd: 1.5,
      // The hook fired a moment after the first call, so a little of the
      // session came before its declaration.
      usageByContext: [
        recorded("feat/linkage", {
          inputTokens: 40,
          outputTokens: 50,
          cacheReadTokens: 20,
          cacheCreationTokens: 10,
          costUsd: 1,
        }),
      ],
    });

    const usage = await serviceFor(session).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });

    expect(usage.totals.inputTokens).toBe(100);
    expect(usage.totals.outputTokens).toBe(50);
    expect(usage.totals.cacheReadTokens).toBe(20);
    expect(usage.totals.cacheCreationTokens).toBe(10);
    expect(usage.totals.costUsd).toBeCloseTo(1.5, 10);
  });

  it("splits by the row's record and keeps the model breakdown to the pull request's own calls", async () => {
    const session = longLivedSession({
      agent: "claude_code",
      inputTokens: 100,
      costUsd: 1,
      usageByContext: [
        recorded("feat/linkage", { inputTokens: 20, costUsd: 0.2 }),
        recorded("feat/next", { inputTokens: 80, costUsd: 0.8 }),
      ],
    });
    const modelTotals = [
      {
        tenantId: "project-1",
        sessionId: session.sessionId,
        model: "claude-fable-5",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        branch: "feat/linkage",
        inputTokens: 20,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0.2,
      },
      {
        tenantId: "project-1",
        sessionId: session.sessionId,
        model: "claude-opus-5",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        branch: "feat/next",
        inputTokens: 80,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0.8,
      },
    ];
    const eventsFor = () => {
      const events = new TestEvents();
      events.modelTotals = modelTotals;
      return events;
    };

    const first = await serviceFor(session, eventsFor()).service.getPullRequestUsage({
      ...query,
      prNumber: LINKAGE_PR,
    });
    const second = await serviceFor(session, eventsFor()).service.getPullRequestUsage(query);

    expect(first.totals.inputTokens).toBe(20);
    expect(first.modelBreakdown.map((model) => model.model)).toEqual(["claude-fable-5"]);
    expect(second.totals.inputTokens).toBe(80);
    expect(second.modelBreakdown.map((model) => model.model)).toEqual(["claude-opus-5"]);
  });

  /** @scenario "The pull request detail and the personal page attribute a session the same way" */
  it("asks about every branch the candidate sessions drove, not just the one queried", async () => {
    // A dormant session: no record, no fact rows, so the legacy rule reads its
    // whole branch history and lands it on the pull request it opened first.
    const session = longLivedSession({
      inputTokens: 180,
      costUsd: 0,
      usageByContext: [],
    });
    const { service, github } = serviceFor(session);

    const detailOfLater = await service.getPullRequestUsage(query);

    expect(detailOfLater.totals.sessionsCount).toBe(0);
    expect(github.branchQueries.some((call) => call.headBranches.includes("feat/linkage"))).toBe(
      true,
    );
  });
});
