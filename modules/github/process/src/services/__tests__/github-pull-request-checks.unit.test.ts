import { describe, expect, it } from "vitest";

import { GithubModule } from "../../app/github.app.ts";
import type { GithubCheckRunSummary, GithubCheckSuiteSummary } from "../../app/github.app.ts";
import { MemoryGithubApiAdapter } from "../../channels/memory/memory.github-api.channel.ts";
/**
 * @vitest-environment node
 * The check_suite webhook on the real GithubFeatureService, over the memory GitHub client,
 * and the turn token's permissions. Spec: modules/github/specs/github-pull-request-checks.feature
 */
import type { RecordPullRequestChecksCompletedCommandData } from "../../eventing/github-lifecycle.events.ts";
import { MemoryGithubRepositories } from "../../repositories/memory/memory.github.repositories.ts";
import { GithubInstallationFactsService } from "../github-installation-facts.service.ts";
import { TestOrganizationService, createTestProjects } from "./fixtures/github-services.fixture.ts";

const INSTALLATION_ID = "4242";
const REPOSITORY_ID = 900;
const SHA = "abc123";

function suite(over: Partial<GithubCheckSuiteSummary> = {}): GithubCheckSuiteSummary {
  return {
    id: 1,
    status: "completed",
    conclusion: "success",
    appName: "GitHub Actions",
    checkRunCount: 1,
    ...over,
  };
}

function run(over: Partial<GithubCheckRunSummary> = {}): GithubCheckRunSummary {
  return {
    name: "test",
    status: "completed",
    conclusion: "success",
    detailsUrl: "https://github.com/acme/agent/runs/1",
    ...over,
  };
}

function checkSuitePayload({
  action = "completed",
  headBranch = "langy/fix-citations",
  headRepoId = REPOSITORY_ID,
  installationId = Number(INSTALLATION_ID),
}: {
  action?: string;
  headBranch?: string;
  headRepoId?: number;
  installationId?: number;
} = {}) {
  return {
    action,
    installation: { id: installationId },
    repository: {
      id: REPOSITORY_ID,
      name: "agent",
      full_name: "acme/agent",
      owner: { login: "acme" },
    },
    check_suite: {
      head_branch: headBranch,
      head_sha: SHA,
      pull_requests: [
        {
          number: 12,
          head: { ref: headBranch, repo: { id: headRepoId } },
          base: { repo: { id: REPOSITORY_ID } },
        },
      ],
    },
  };
}

async function harness({
  pullRequestState = "open",
  installed = true,
}: { pullRequestState?: string; installed?: boolean } = {}) {
  const repositories = MemoryGithubRepositories.create();
  const api = MemoryGithubApiAdapter.create();
  api.seedInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "1",
    repositorySelection: "all",
    createdAt: null,
    permissions: { contents: "write", pull_requests: "write", checks: "read" },
  });
  api.seedPullRequest({
    owner: "acme",
    repo: "agent",
    number: 12,
    htmlUrl: "https://github.com/acme/agent/pull/12",
    title: "fix citations",
    state: pullRequestState,
    draft: false,
    mergedAt: null,
    closedAt: null,
    createdAt: "2026-11-12T00:00:00Z",
    updatedAt: "2026-11-12T00:00:00Z",
    authorLogin: "langwatch[bot]",
  });
  if (installed) {
    await repositories.installations.upsert({
      installationId: INSTALLATION_ID,
      organizationId: "org-1",
      accountLogin: "acme",
      accountType: "Organization",
      accountId: "1",
      repositorySelection: "all",
      repositories: null,
    });
  }
  const sent: RecordPullRequestChecksCompletedCommandData[] = [];
  const facts = GithubInstallationFactsService.create();
  facts.connect({
    recordInstallationConnected: { send: async () => undefined },
    recordPullRequestChecksCompleted: { send: async (data) => void sent.push(data) },
  });
  const github = GithubModule.composeApi({
    repositories,
    api,
    config: { appSlug: "test-app", webhookSecret: "secret", signingKey: "key" },
    organization: new TestOrganizationService().api,
    project: createTestProjects({ organizationId: "org-1" }),
    facts,
  });

  const apply = (payload: object) =>
    github.applyWebhookPayload({
      payload: { ...payload },
      eventType: "check_suite",
      deliveryId: "d",
    });

  return { github, api, sent, apply };
}

function commitReads(api: MemoryGithubApiAdapter): number {
  return api.mints.filter((mint) => mint.permissions?.checks === "read").length;
}

describe("the check_suite webhook", () => {
  describe("when every check suite on a Langy pull request's head commit finished", () => {
    /** @scenario "The last check suite to finish on a Langy pull request records the fact" */
    it("records one fact naming the repository, branch, commit, pull request and failed check", async () => {
      const { api, sent, apply } = await harness();
      api.seedCommitChecks({
        owner: "acme",
        repo: "agent",
        sha: SHA,
        suites: [suite({ id: 1, conclusion: "failure" }), suite({ id: 2 })],
        runs: [run({ name: "lint" }), run({ name: "unit", conclusion: "failure" })],
      });

      await apply(checkSuitePayload());

      expect(sent).toEqual([
        expect.objectContaining({
          tenantId: "org-1",
          organizationId: "org-1",
          installationId: INSTALLATION_ID,
          repositoryHost: "github.com",
          repositoryFullName: "acme/agent",
          headBranch: "langy/fix-citations",
          headSha: SHA,
          pullRequestNumbers: [12],
          conclusion: "failure",
          failedChecks: [
            { name: "unit", conclusion: "failure", url: "https://github.com/acme/agent/runs/1" },
          ],
        }),
      ]);
    });
  });

  describe("when another check suite on the commit is still running", () => {
    /** @scenario "A check suite that finishes while others still run records nothing" */
    it("records nothing", async () => {
      const { api, sent, apply } = await harness();
      api.seedCommitChecks({
        owner: "acme",
        repo: "agent",
        sha: SHA,
        suites: [suite({ id: 1 }), suite({ id: 2, status: "in_progress", conclusion: null })],
        runs: [run()],
      });

      await apply(checkSuitePayload());

      expect(sent).toEqual([]);
    });
  });

  describe("when a queued suite has no check runs", () => {
    /** @scenario "A check suite with no check runs does not hold the announcement back" */
    it("records the fact anyway", async () => {
      const { api, sent, apply } = await harness();
      api.seedCommitChecks({
        owner: "acme",
        repo: "agent",
        sha: SHA,
        suites: [suite(), suite({ id: 3, status: "queued", conclusion: null, checkRunCount: 0 })],
        runs: [run()],
      });

      await apply(checkSuitePayload());

      expect(sent).toEqual([expect.objectContaining({ conclusion: "success", failedChecks: [] })]);
    });
  });

  describe("when the branch is not a Langy branch", () => {
    /** @scenario "A branch Langy did not open is not announced" */
    it("never asks GitHub about the commit", async () => {
      const { api, sent, apply } = await harness();

      await apply(checkSuitePayload({ headBranch: "feature/manual" }));

      expect(commitReads(api)).toBe(0);
      expect(sent).toEqual([]);
    });
  });

  describe("when the pull request comes from a fork", () => {
    /** @scenario "A pull request from a fork is not announced" */
    it("records nothing", async () => {
      const { api, sent, apply } = await harness();

      await apply(checkSuitePayload({ headRepoId: 77 }));

      expect(commitReads(api)).toBe(0);
      expect(sent).toEqual([]);
    });
  });

  describe("when the pull request was closed", () => {
    /** @scenario "A closed pull request is not announced" */
    it("records nothing", async () => {
      const { api, sent, apply } = await harness({ pullRequestState: "closed" });
      api.seedCommitChecks({
        owner: "acme",
        repo: "agent",
        sha: SHA,
        suites: [suite()],
        runs: [run()],
      });

      await apply(checkSuitePayload());

      expect(sent).toEqual([]);
    });
  });

  describe("when no organization connected the installation", () => {
    /** @scenario "A check suite from an installation no organization connected is dropped" */
    it("records nothing and acknowledges the delivery", async () => {
      const { api, sent, apply } = await harness({ installed: false });
      api.seedCommitChecks({
        owner: "acme",
        repo: "agent",
        sha: SHA,
        suites: [suite()],
        runs: [run()],
      });

      await expect(apply(checkSuitePayload())).resolves.toBeUndefined();

      expect(sent).toEqual([]);
    });
  });

  describe("when the suite was only requested", () => {
    /** @scenario "A check suite that is not completed is ignored" */
    it("never asks GitHub about the commit", async () => {
      const { api, apply } = await harness();

      await apply(checkSuitePayload({ action: "requested" }));

      expect(commitReads(api)).toBe(0);
    });
  });

  describe("when GitHub refuses to list the commit's checks", () => {
    /** @scenario "A failure to read the commit's checks is logged and acknowledged" */
    it("records nothing and still resolves", async () => {
      const { api, sent, apply } = await harness();
      api.refuseCommitChecks({ owner: "acme", repo: "agent", sha: SHA });

      await expect(apply(checkSuitePayload())).resolves.toBeUndefined();

      expect(sent).toEqual([]);
    });
  });
});

async function turnTokenHarness(granted: Record<string, string>) {
  const repositories = MemoryGithubRepositories.create();
  const api = MemoryGithubApiAdapter.create();
  api.seedInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "1",
    repositorySelection: "selected",
    createdAt: null,
    permissions: granted,
  });
  await repositories.installations.upsert({
    installationId: INSTALLATION_ID,
    organizationId: "org-1",
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "1",
    repositorySelection: "selected",
    repositories: [
      { id: "900", fullName: "acme/agent" },
      { id: "901", fullName: "acme/web" },
    ],
  });
  const github = GithubModule.composeApi({
    repositories,
    api,
    config: { appSlug: "test-app", webhookSecret: "secret", signingKey: "key" },
    organization: new TestOrganizationService().api,
    project: createTestProjects({ organizationId: "org-1" }),
  });
  return { github, api };
}

describe("a turn token", () => {
  describe("when the installation granted CI access", () => {
    /** @scenario "A turn token includes CI access the installation granted" */
    it("asks for actions, checks and workflows beside the write pair", async () => {
      const { github, api } = await turnTokenHarness({
        contents: "write",
        pull_requests: "write",
        actions: "write",
        checks: "write",
        workflows: "write",
      });

      const [token] = await github.findTurnTokens({ organizationId: "org-1" });

      expect(token?.token).toBeTruthy();
      expect(api.mints.at(-1)?.permissions).toEqual({
        contents: "write",
        pull_requests: "write",
        actions: "write",
        checks: "read",
        workflows: "write",
      });
    });
  });

  describe("when an older installation granted only the write pair", () => {
    /** @scenario "A turn token leaves out what an older installation never granted" */
    it("asks for the write pair only and still mints", async () => {
      const { github, api } = await turnTokenHarness({ contents: "write", pull_requests: "write" });

      const tokens = await github.findTurnTokens({ organizationId: "org-1" });

      expect(tokens).toHaveLength(1);
      expect(api.mints.at(-1)?.permissions).toEqual({ contents: "write", pull_requests: "write" });
    });
  });

  describe("when the installation granted actions read only", () => {
    /** @scenario "A turn token never asks for more than the installation granted" */
    it("asks for actions read", async () => {
      const { github, api } = await turnTokenHarness({
        contents: "write",
        pull_requests: "write",
        actions: "read",
      });

      await github.findTurnTokens({ organizationId: "org-1" });

      expect(api.mints.at(-1)?.permissions?.actions).toBe("read");
    });
  });

  describe("when the turn names one repository", () => {
    /** @scenario "A turn token for one repository is minted for that repository only" */
    it("scopes the mint to that repository's id", async () => {
      const { github, api } = await turnTokenHarness({ contents: "write", pull_requests: "write" });

      await github.findTurnTokens({ organizationId: "org-1", repositoryFullName: "acme/agent" });

      expect(api.mints.at(-1)?.repositoryIds).toEqual(["900"]);
    });
  });
});
