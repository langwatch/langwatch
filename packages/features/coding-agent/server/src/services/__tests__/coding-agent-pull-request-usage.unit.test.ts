import { describe, expect, it } from "vitest";
import { GithubPullRequestNotMappedError } from "@langwatch/github-contract";
import { USAGE_SESSION_WINDOW_MS } from "../coding-agent-pull-request-read.service";
import { CodingAgentFeatureService } from "../coding-agent.service";
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
} from "../../repositories/__tests__/fixtures/coding-agent.fixture";

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
    expect(events.modelTotalInputs).toEqual([
      {
        tenantIds: ["project-1", "project-2"],
        sessionIds: ["in-pr", "unpriced"],
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
