import { describe, expect, it } from "vitest";
import {
  SESSIONS_LIST_LIMIT,
  SESSIONS_LIST_WINDOW_MS,
} from "../coding-agent-pull-request-read.service";
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
  pullRequest,
  session,
} from "../../repositories/__tests__/fixtures/coding-agent.fixture";

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
  /**
   * @scenario "The list answers with the sessions of the last ninety days"
   * @scenario "A row carries what a session cost in context, not only in tokens"
   * @scenario "A row is named by the title the session generated"
   * @scenario "The session's own name is the title the list shows"
   */
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

  /**
   * @scenario "A session that worked on two branches lists both of their pull requests"
   * @scenario "The pull requests of a whole page are looked up in one call"
   * @scenario "A session recorded before branches were remembered falls back to its last branch"
   */
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

  /** @scenario "A workspace whose organization has no GitHub connection still lists its sessions" */
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

  it("links trace sessions through the canonical service", async () => {
    const github = new TestGithubService();
    github.pullRequests = [
      pullRequest({
        repositoryHost: "github.com",
        repositoryFullName: "acme/widgets",
        headBranch: "feat/linkage",
        prNumber: 7,
        htmlUrl: "https://github.com/acme/widgets/pull/7",
        title: "Link sessions to pull requests",
        prCreatedAt: new Date(TEST_NOW_MS - HOUR_MS),
      }),
    ];
    const service = serviceWith({ sessions: new TestSessions(), github });

    const links = await service.linkTraceSessionsToPullRequests({
      organizationId: "organization-1",
      sessions: [
        {
          sessionId: "session-a",
          startedAtMs: TEST_NOW_MS,
          repositoryHost: "GitHub.com",
          repositoryOwner: "ACME",
          repositoryName: "Widgets",
          gitBranch: "feat/linkage",
        },
      ],
    });

    expect(github.branchLookupInputs).toEqual([
      {
        organizationId: "organization-1",
        keys: [
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            headBranch: "feat/linkage",
          },
        ],
      },
    ]);
    expect(links).toEqual([
      {
        sessionId: "session-a",
        pullRequest: {
          number: 7,
          htmlUrl: "https://github.com/acme/widgets/pull/7",
          title: "Link sessions to pull requests",
        },
      },
    ]);
  });

  describe("given a personal workspace with coding-agent sessions", () => {
    /** @scenario "The list answers with the sessions of the last ninety days" */
    it("asks for the trailing ninety days, one page at most", async () => {
      const sessions = new TestSessions();
      sessions.rows = [session()];
      const service = serviceWith({ sessions });

      await service.listForProject({ projectId: PROJECT });

      expect(sessions.recentInputs).toEqual([
        {
          tenantId: PROJECT,
          fromMs: TEST_NOW_MS - SESSIONS_LIST_WINDOW_MS,
          toMs: TEST_NOW_MS,
          limit: SESSIONS_LIST_LIMIT,
        },
      ]);
      expect(SESSIONS_LIST_WINDOW_MS).toBe(90 * 24 * HOUR_MS);
    });

    /** @scenario "A row carries what a session cost in context, not only in tokens" */
    it("carries the context economics, the time split and the totals", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({
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
          agentVersion: "2.0.0",
        }),
      ];
      const service = serviceWith({ sessions });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(row).toMatchObject({
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
      });
    });

    /** @scenario "A row is named by the title the session generated" */
    it("names a row by its title, and says so when there is none", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({ title: "Add the sessions screen" }),
        session({ sessionId: "session-b", title: "" }),
      ];
      const service = serviceWith({ sessions });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows[0]?.title).toBe("Add the sessions screen");
      // Nothing to show reads as nothing, never as an empty string, so the
      // page renders its own words for an untitled session.
      expect(rows[1]?.title).toBeNull();
    });

    /** @scenario "The session's own name is the title the list shows" */
    it("shows the one Title column the fold already resolved", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({ title: "pr-reviewer", titleSource: "name" }),
        session({ sessionId: "session-b", title: "", titleSource: "" }),
      ];
      const service = serviceWith({ sessions });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows[0]?.title).toBe("pr-reviewer");
      expect(rows[1]?.title).toBeNull();
    });
  });

  describe("when a session drove more than one branch", () => {
    /** @scenario "A session that worked on two branches lists both of their pull requests" */
    it("lists a pull request per branch, by number ascending", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({
          repositoryOwner: "acme",
          repositoryName: "widgets",
          gitBranch: "feat/two",
          gitBranches: ["feat/one", "feat/two"],
        }),
      ];
      const github = new TestGithubService();
      github.pullRequests = [
        pullRequest({ repositoryFullName: "acme/widgets", headBranch: "feat/two", prNumber: 42 }),
        pullRequest({ repositoryFullName: "acme/widgets", headBranch: "feat/one", prNumber: 11 }),
      ];
      const service = serviceWith({ sessions, github });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(row?.pullRequests.map((pull) => pull.number)).toEqual([11, 42]);
    });

    /** @scenario "The pull requests of a whole page are looked up in one call" */
    it("looks the whole page up once, on its distinct branch keys", async () => {
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
          gitBranch: "feat/two",
          gitBranches: ["feat/one", "feat/two"],
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
      const service = serviceWith({ sessions, github });

      await service.listForProject({ projectId: PROJECT });

      expect(github.branchLookupInputs).toHaveLength(1);
      // Two sessions sharing a repository and branches ask once for each, and
      // the third repository joins the same call.
      expect(github.branchLookupInputs[0]?.keys).toEqual([
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
      ]);
    });

    // A branch that hosted a merged pull request and later another one is the
    // reason the tenure rule exists: a session belongs to the era it ran in,
    // never to every pull request the branch ever had.
    it("takes the pull request whose era the session ran in", async () => {
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

      expect(row?.pullRequests.map((pull) => pull.number)).toEqual([9]);
    });

    /** @scenario "A session recorded before branches were remembered falls back to its last branch" */
    it("finds the pull requests of a row that has only its last branch", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({
          repositoryOwner: "acme",
          repositoryName: "widgets",
          gitBranches: [],
          gitBranch: "feat/one",
        }),
      ];
      const github = new TestGithubService();
      github.pullRequests = [
        pullRequest({ repositoryFullName: "acme/widgets", headBranch: "feat/one", prNumber: 11 }),
      ];
      const service = serviceWith({ sessions, github });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(github.branchLookupInputs[0]?.keys).toEqual([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          headBranch: "feat/one",
        },
      ]);
      expect(row?.pullRequests.map((pull) => pull.number)).toEqual([11]);
      // The row answers with the one branch it does know about, so the page
      // never shows a session as having driven nothing.
      expect(row?.gitBranches).toEqual(["feat/one"]);
    });
  });

  describe("when the join cannot answer", () => {
    /** @scenario "A workspace whose organization has no GitHub connection still lists its sessions" */
    it("lists every session with no pull requests", async () => {
      const sessions = new TestSessions();
      sessions.rows = [session({ repositoryOwner: "acme", repositoryName: "widgets" })];
      const projects = new TestProjectService();
      projects.teamProject = null;
      const github = new TestGithubService();
      const service = serviceWith({ sessions, projects, github });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.pullRequests).toEqual([]);
      expect(github.branchLookupInputs).toEqual([]);
    });

    it("lists the sessions anyway when the lookup fails", async () => {
      const sessions = new TestSessions();
      sessions.rows = [session({ repositoryOwner: "acme", repositoryName: "widgets" })];
      const github = new TestGithubService();
      github.mappingError = new Error("mapping unavailable");
      const service = serviceWith({ sessions, github });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.pullRequests).toEqual([]);
    });

    it("asks nothing when no session names a repository", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({ repositoryOwner: "", repositoryName: "", gitBranch: "", gitBranches: [] }),
      ];
      const github = new TestGithubService();
      const service = serviceWith({ sessions, github });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows[0]?.pullRequests).toEqual([]);
      expect(github.branchLookupInputs).toEqual([]);
    });
  });
});
