import { describe, expect, it } from "vitest";
import {
  PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP,
  PULL_REQUEST_MAPPING_BACKFILL_SESSIONS_PER_PROJECT,
  PULL_REQUEST_MAPPING_BACKFILL_WINDOW_MS,
} from "../coding-agent-pull-request-mapping-backfill.service";
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
  session,
} from "../../repositories/__tests__/fixtures/coding-agent.fixture";

function serviceWith(input: {
  sessions: TestSessions;
  github: TestGithubService;
  projects: TestProjectService;
}) {
  return CodingAgentFeatureService.create({
    sessions: input.sessions,
    traceSessions: new TestTraceSessions(),
    metricSeries: new TestMetricSeries(),
    sessionEvents: new TestEvents(),
    github: input.github,
    projects: input.projects,
    billing: new TestBillingPolicy(),
    clock: new TestClock(),
  });
}

describe("Coding Agent installation backfill", () => {
  it("reads each organization project in its bounded recent window and asks GitHub once per canonical branch", async () => {
    const sessions = new TestSessions();
    sessions.recentRowsByTenant.set("project-a", [
      session({
        tenantId: "project-a",
        repositoryHost: "GitHub.COM",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feature",
      }),
      session({
        tenantId: "project-a",
        repositoryHost: "github.com",
        repositoryOwner: "ACME",
        repositoryName: "Widgets",
        gitBranch: "feature",
      }),
      session({
        tenantId: "project-a",
        repositoryHost: "github.example.test",
        repositoryOwner: "acme",
        repositoryName: "ignored",
        gitBranch: "feature",
      }),
    ]);
    sessions.recentRowsByTenant.set("project-b", [
      session({
        tenantId: "project-b",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feature",
      }),
      session({
        tenantId: "project-b",
        repositoryOwner: "",
        repositoryName: "",
        gitBranch: "",
      }),
    ]);
    const projects = new TestProjectService();
    projects.projects = [{ id: "project-a" }, { id: "project-b" }];
    const github = new TestGithubService();
    const service = serviceWith({ sessions, projects, github });

    await service.backfillPullRequestMappings({ organizationId: "organization-1" });

    expect(sessions.recentInputs).toEqual([
      {
        tenantId: "project-a",
        fromMs: TEST_NOW_MS - PULL_REQUEST_MAPPING_BACKFILL_WINDOW_MS,
        toMs: TEST_NOW_MS,
        limit: PULL_REQUEST_MAPPING_BACKFILL_SESSIONS_PER_PROJECT,
      },
      {
        tenantId: "project-b",
        fromMs: TEST_NOW_MS - PULL_REQUEST_MAPPING_BACKFILL_WINDOW_MS,
        toMs: TEST_NOW_MS,
        limit: PULL_REQUEST_MAPPING_BACKFILL_SESSIONS_PER_PROJECT,
      },
    ]);
    expect(github.mappingRequests).toEqual([
      {
        tenantId: "project-a",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feature",
      },
    ]);
    expect(PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP).toBe(500);
  });

  it("contains a mapping failure so GitHub installation remains non-blocking", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feature",
      }),
    ];
    const projects = new TestProjectService();
    projects.projects = [{ id: "project-1" }];
    const github = new TestGithubService();
    github.mappingError = new Error("GitHub rate limited");
    const service = serviceWith({ sessions, projects, github });

    await expect(
      service.backfillPullRequestMappings({ organizationId: "organization-1" }),
    ).resolves.toBeUndefined();

    expect(github.mappingRequests).toHaveLength(1);
  });
});
