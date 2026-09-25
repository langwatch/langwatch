/**
 * Tests that branch-refresh sweep works with just a database, without the
 * full GitHub API composition.
 */
import { generateKeyPairSync } from "node:crypto";

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, describe, expect, it, vi } from "vitest";

import { unansweredRedisRepositories } from "../../__tests__/support/github-unanswered-redis.support.ts";
import { GithubApp } from "../../app/github.app.ts";
import { PrismaGithubInstallationsRepository } from "../../repositories/prisma/prisma.github-installations.repository.ts";
import { PrismaGithubPullRequestsRepository } from "../../repositories/prisma/prisma.github-pull-requests.repository.ts";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const DUE_BRANCH = {
  organizationId: "organization-1",
  repositoryHost: "github.com",
  repositoryFullName: "acme/refunds",
  headBranch: "feat/refunds",
  lastCheckedAt: new Date("2026-08-01T00:00:00.000Z"),
  prCount: 0,
  notFoundAt: new Date("2026-08-01T00:00:00.000Z"),
  recheckAfter: new Date("2026-08-01T00:15:00.000Z"),
  attempts: 1,
  lastRequestedAt: new Date("2026-08-01T00:00:00.000Z"),
};

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

/** A Prisma stand-in holding one due branch and one installation. */
function database(over: { due?: (typeof DUE_BRANCH)[]; claimed?: number } = {}) {
  const writes: Written[] = [];
  const write = (model: string) => async (args: Record<string, unknown>) => {
    writes.push({ model, args });
    return model.endsWith("updateMany") ? { count: 0 } : {};
  };

  return {
    writes,
    client: prismaDouble({
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
        findMany: async () => over.due ?? [DUE_BRANCH],
        findUnique: async () => null,
        updateMany: write("githubBranchPullRequestCheck.updateMany"),
        upsert: write("githubBranchPullRequestCheck.upsert"),
      },
      $executeRaw: async () => over.claimed ?? 1,
    }),
  };
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

function sweep(client: PrismaClient) {
  return GithubApp.composeBranchMaintenance({
    repositories: {
      ...unansweredRedisRepositories(),
      installations: PrismaGithubInstallationsRepository.create(client),
      pullRequests: PrismaGithubPullRequestsRepository.create(client),
    },
    config: { appId: "1234", privateKey },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the GitHub branch sweep composed from Postgres alone", () => {
  describe("given a due branch and an installation that covers it", () => {
    /** @scenario "The branch sweep runs without an organization or a project service" */
    it("maps the branch and stores the pull request it found", async () => {
      const { client, writes } = database();
      const paths = githubApi();

      await expect(sweep(client).recheckDueBranches()).resolves.toBe(1);

      expect(paths).toEqual([
        "/app/installations/install-1/access_tokens",
        "/repos/acme/refunds/pulls?head=acme%3Afeat%2Frefunds&state=all&per_page=50",
      ]);
      expect(
        writes.find((entry) => entry.model === "githubPullRequest.create")?.args.data,
      ).toMatchObject({
        organizationId: "organization-1",
        repositoryFullName: "acme/refunds",
        headBranch: "feat/refunds",
        prNumber: 7,
      });
    });

    /** @scenario "The branch sweep records what it found against the branch" */
    it("clears the branch's not-found bookkeeping once it maps", async () => {
      const { client, writes } = database();
      githubApi();

      await sweep(client).recheckDueBranches();

      const check = writes.find((entry) => entry.model === "githubBranchPullRequestCheck.upsert")
        ?.args.create as Record<string, unknown> | undefined;
      expect(check).toMatchObject({ prCount: 1, notFoundAt: null, recheckAfter: null });
    });
  });

  describe("given no GitHub App credentials", () => {
    /** @scenario "A sweep without App credentials asks GitHub nothing" */
    it("asks GitHub nothing and writes nothing, rather than failing", async () => {
      const { client, writes } = database();
      const paths = githubApi();
      const uncredentialed = GithubApp.composeBranchMaintenance({
        repositories: {
          ...unansweredRedisRepositories(),
          installations: PrismaGithubInstallationsRepository.create(client),
          pullRequests: PrismaGithubPullRequestsRepository.create(client),
        },
        config: { appId: "", privateKey: "" },
      });

      await expect(uncredentialed.recheckDueBranches()).resolves.toBe(1);

      expect(paths).toEqual([]);
      expect(writes).toEqual([]);
    });

    /** @scenario "The retention prune runs without App credentials" */
    it("still prunes bookkeeping past the activity horizon", async () => {
      const { client } = database();
      const uncredentialed = GithubApp.composeBranchMaintenance({
        repositories: {
          ...unansweredRedisRepositories(),
          installations: PrismaGithubInstallationsRepository.create(client),
          pullRequests: PrismaGithubPullRequestsRepository.create(client),
        },
        config: { appId: "", privateKey: "" },
      });

      await expect(uncredentialed.pruneStaleBranchLinkage()).resolves.toEqual({
        branchChecks: 1,
      });
    });
  });
});
