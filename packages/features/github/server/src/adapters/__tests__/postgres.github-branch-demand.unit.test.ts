/**
 * Whether a process that holds a database and one project seam can run the
 * demand half of pull-request linkage.
 *
 * Demand was reachable only through `PostgresGithubAdapter`, which takes an
 * `OrganizationService` and a full `ProjectService`. It genuinely needs two
 * project facts — the organization a tenant belongs to, and the activity stamp
 * a successful mapping writes — and nothing else in either service. What
 * matters here is therefore not that it constructs: it is that a branch a
 * session is looking at maps all the way to a stored pull request through a
 * graph holding neither service.
 *
 * Spec: packages/features/github/specs/github-branch-maintenance.feature
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GithubProjectActivityPort } from "../../ports/github-project-activity.port";
import { PostgresGithubBranchDemandAdapter } from "../postgres.github-branch-demand.adapter";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const PULL_REQUEST = {
  number: 7,
  html_url: "https://github.com/acme/refunds/pull/7",
  title: "Refunds",
  state: "open",
  draft: false,
  merged_at: null,
  closed_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  user: { login: "someone" },
};

type Written = { model: string; args: Record<string, unknown> };

/** A Prisma stand-in holding one installation that covers the repository. */
function database() {
  const writes: Written[] = [];
  const write = (model: string) => async (args: Record<string, unknown>) => {
    writes.push({ model, args });
    return model.endsWith("updateMany") ? { count: 0 } : {};
  };

  return {
    writes,
    client: {
      githubInstallation: {
        findMany: async () => [
          {
            installationId: "install-1",
            organizationId: "organization-1",
            accountLogin: "acme",
            accountType: "Organization",
            accountId: "1",
            repositorySelection: "selected",
            repositories: [{ id: "42", fullName: "acme/refunds" }],
            suspendedAt: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      },
      githubPullRequest: {
        findMany: async () => [],
        updateMany: write("githubPullRequest.updateMany"),
        create: write("githubPullRequest.create"),
      },
      githubBranchPullRequestCheck: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: write("githubBranchPullRequestCheck.updateMany"),
        upsert: write("githubBranchPullRequestCheck.upsert"),
      },
      $executeRaw: async () => 1,
    },
  };
}

class RecordingProjectActivity extends GithubProjectActivityPort {
  readonly resolved: string[] = [];
  readonly stamped: { projectId: string; at: Date }[] = [];

  async getOrganizationId(projectId: string): Promise<string> {
    this.resolved.push(projectId);
    return "organization-1";
  }

  async touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void> {
    this.stamped.push(input);
  }
}

/** GitHub, reduced to the token mint and the branch's pull requests. */
function githubApi() {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    paths.push(new URL(url).pathname + new URL(url).search);
    if (url.includes("access_tokens")) {
      return Response.json({ token: "ghs_1", expires_at: "2026-08-02T01:00:00.000Z" });
    }
    return Response.json([PULL_REQUEST]);
  });
  return paths;
}

function demand(client: object, project: GithubProjectActivityPort) {
  return PostgresGithubBranchDemandAdapter.create({
    database: client as never,
    config: { appId: "1234", privateKey },
    redis: null,
    project,
  }).build();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the GitHub branch demand path composed from Postgres alone", () => {
  describe("given a branch a coding-agent session is looking at", () => {
    /** @scenario "Branch demand runs on two project facts rather than a project service" */
    it("resolves the organization through the project seam it was given", async () => {
      const { client } = database();
      const project = new RecordingProjectActivity();
      githubApi();

      await demand(client, project).requestBranchMapping({
        tenantId: "project_alpha",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "refunds",
        headBranch: "feat/refunds",
      });

      expect(project.resolved).toEqual(["project_alpha"]);
    });

    /** @scenario "Branch demand runs on two project facts rather than a project service" */
    it("stores the pull request GitHub reports for the branch", async () => {
      const { client, writes } = database();
      githubApi();

      await demand(client, new RecordingProjectActivity()).requestBranchMapping({
        tenantId: "project_alpha",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "refunds",
        headBranch: "feat/refunds",
      });

      expect(
        writes.find((entry) => entry.model === "githubPullRequest.create")?.args.data,
      ).toMatchObject({
        organizationId: "organization-1",
        repositoryFullName: "acme/refunds",
        headBranch: "feat/refunds",
        prNumber: 7,
      });
    });

    /** @scenario "Branch demand runs on two project facts rather than a project service" */
    it("records the project as having had a pull request mapped", async () => {
      const { client } = database();
      const project = new RecordingProjectActivity();
      githubApi();

      await demand(client, project).requestBranchMapping({
        tenantId: "project_alpha",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "refunds",
        headBranch: "feat/refunds",
      });

      expect(project.stamped.map((entry) => entry.projectId)).toEqual(["project_alpha"]);
    });
  });

  describe("given a repository on another host", () => {
    /** @scenario "Demand declines a repository host this instance cannot answer for" */
    it("refuses before any organization is resolved", async () => {
      const { client } = database();
      const project = new RecordingProjectActivity();
      const paths = githubApi();
      const composed = demand(client, project);

      expect(composed.canMapRepositoryHost("gitlab.example.com")).toBe(false);
      await composed.requestBranchMapping({
        tenantId: "project_alpha",
        repositoryHost: "gitlab.example.com",
        repositoryOwner: "acme",
        repositoryName: "refunds",
        headBranch: "feat/refunds",
      });

      expect(project.resolved).toEqual([]);
      expect(paths).toEqual([]);
    });
  });
});
