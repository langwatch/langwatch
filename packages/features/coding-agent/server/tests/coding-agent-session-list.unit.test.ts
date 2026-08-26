import { describe, expect, it } from "vitest";
import {
  SESSIONS_LIST_LIMIT,
  SESSIONS_LIST_WINDOW_MS,
} from "../src/services/coding-agent-pull-request-read.service";
import { CodingAgentFeatureService } from "../src/services/coding-agent.service";
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
  pullRequest,
  session,
} from "./fixtures/coding-agent.fixture";

const PROJECT = "project-1";
const HOUR_MS = 60 * 60 * 1000;

function serviceWith(input: {
  sessions: TestSessions;
  github?: TestGithubService;
  projects?: TestProjectService;
}) {
  return CodingAgentFeatureService.create({
    sessions: input.sessions,
    traceSessions: new TestTraceSessions(),
    metricSeries: new TestMetricSeries(),
    sessionEvents: new TestEvents(),
    github: input.github ?? new TestGithubService(),
    projects: input.projects ?? new TestProjectService(),
    billing: new TestBillingPolicy(),
    clock: new TestClock(),
  });
}

describe("Coding Agent sessions list", () => {
  it("reads one trailing ninety-day page and carries all public session facts", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        sessionId: "session-a",
        startedAtMs: TEST_NOW_MS - 5 * HOUR_MS,
        lastEventOccurredAt: TEST_NOW_MS - 4 * HOUR_MS,
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/two",
        gitBranches: ["feat/one", "feat/two"],
        title: "Add the sessions screen",
        agentVersion: "2.0.0",
        peakContextTokens: 180_000,
        compactions: 2,
        compactionTokensBefore: 170_000,
        compactionTokensAfter: 40_000,
        cacheRebuildCount: 3,
        largestCacheRebuildTokens: 90_000,
        activeTimeCliSec: 1_800,
        blockedOnUserMs: 600_000,
        inputTokens: 1_000,
        outputTokens: 2_000,
        cacheReadTokens: 3_000,
        cacheCreationTokens: 4_000,
        costUsd: 12.5,
        models: ["claude-fable-5"],
      }),
      session({
        sessionId: "session-b",
        repositoryOwner: "",
        repositoryName: "",
        gitBranch: "",
        title: "",
      }),
    ];
    const service = serviceWith({ sessions });

    const rows = await service.listForProject({ projectId: PROJECT });

    expect(sessions.recentInputs).toEqual([
      {
        tenantId: PROJECT,
        fromMs: TEST_NOW_MS - SESSIONS_LIST_WINDOW_MS,
        toMs: TEST_NOW_MS,
        limit: SESSIONS_LIST_LIMIT,
      },
    ]);
    expect(rows[0]).toMatchObject({
      sessionId: "session-a",
      title: "Add the sessions screen",
      agent: "claude_code",
      agentVersion: "2.0.0",
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      gitBranch: "feat/two",
      gitBranches: ["feat/one", "feat/two"],
      startedAtMs: TEST_NOW_MS - 5 * HOUR_MS,
      lastEventOccurredAtMs: TEST_NOW_MS - 4 * HOUR_MS,
      peakContextTokens: 180_000,
      compactions: 2,
      compactionTokensBefore: 170_000,
      compactionTokensAfter: 40_000,
      cacheRebuildCount: 3,
      largestCacheRebuildTokens: 90_000,
      activeTimeCliSec: 1_800,
      blockedOnUserMs: 600_000,
      inputTokens: 1_000,
      outputTokens: 2_000,
      cacheReadTokens: 3_000,
      cacheCreationTokens: 4_000,
      costUsd: 12.5,
      models: ["claude-fable-5"],
      pullRequests: [],
    });
    expect(rows[1]).toMatchObject({ title: null, gitBranches: [], pullRequests: [] });
  });

  it("looks up each distinct branch once, links every driven branch in number order, and falls back to the last branch", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        sessionId: "session-a",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/two",
        gitBranches: ["feat/one", "feat/two"],
      }),
      session({
        sessionId: "session-b",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/one",
        gitBranches: [],
      }),
      session({
        sessionId: "session-c",
        repositoryOwner: "acme",
        repositoryName: "gadgets",
        gitBranch: "fix/crash",
        gitBranches: ["fix/crash"],
      }),
    ];
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: "acme/widgets",
        headBranch: "feat/two",
        prNumber: 42,
      }),
      pullRequest({
        repositoryFullName: "acme/widgets",
        headBranch: "feat/one",
        prNumber: 11,
      }),
    ];
    const service = serviceWith({ sessions, github });

    const rows = await service.listForProject({ projectId: PROJECT });

    expect(github.branchLookupInputs).toEqual([
      {
        organizationId: "organization-1",
        keys: [
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            headBranch: "feat/one",
          },
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            headBranch: "feat/two",
          },
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/gadgets",
            headBranch: "fix/crash",
          },
        ],
      },
    ]);
    expect(rows[0]?.pullRequests.map((row) => row.number)).toEqual([11, 42]);
    expect(rows[1]).toMatchObject({
      gitBranches: ["feat/one"],
      pullRequests: [{ number: 11 }],
    });
  });

  it("uses pull-request tenure rather than assigning a session to every historical pull request", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/one",
        gitBranches: ["feat/one"],
        startedAtMs: TEST_NOW_MS - 2 * HOUR_MS,
      }),
    ];
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryFullName: "acme/widgets",
        headBranch: "feat/one",
        prNumber: 5,
        prCreatedAt: new Date(TEST_NOW_MS - 40 * HOUR_MS),
        prClosedAt: new Date(TEST_NOW_MS - 30 * HOUR_MS),
        prMergedAt: new Date(TEST_NOW_MS - 30 * HOUR_MS),
      }),
      pullRequest({
        repositoryFullName: "acme/widgets",
        headBranch: "feat/one",
        prNumber: 9,
        prCreatedAt: new Date(TEST_NOW_MS - 3 * HOUR_MS),
      }),
    ];
    const service = serviceWith({ sessions, github });

    const [row] = await service.listForProject({ projectId: PROJECT });

    expect(row?.pullRequests.map((pullRequest) => pullRequest.number)).toEqual([9]);
  });

  it("keeps session rows when the project has no organization", async () => {
    const sessions = new TestSessions();
    sessions.rows = [session({ repositoryOwner: "acme", repositoryName: "widgets" })];
    const projects = new TestProjectService();
    projects.teamProject = null;
    const service = serviceWith({ sessions, projects });

    const rows = await service.listForProject({ projectId: PROJECT });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pullRequests).toEqual([]);
  });

  it("keeps session rows when GitHub enrichment fails", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feature",
      }),
    ];
    const github = new TestGithubService();
    github.mappingError = new Error("GitHub unavailable");
    const service = serviceWith({ sessions, github });

    const rows = await service.listForProject({ projectId: PROJECT });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pullRequests).toEqual([]);
  });

  it("does not ask GitHub when no session names a repository", async () => {
    const sessions = new TestSessions();
    sessions.rows = [session({ repositoryOwner: "", repositoryName: "", gitBranch: "" })];
    const github = new TestGithubService();
    const service = serviceWith({ sessions, github });

    await service.listForProject({ projectId: PROJECT });

    expect(github.branchLookupInputs).toEqual([]);
  });
});
