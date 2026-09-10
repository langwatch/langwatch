/**
 * The two GitHub repositories' contract: the freshness guard on a snapshot
 * write, the atomic branch claim, the demand stamp and the retention delete.
 *
 * The memory twin is the only backend registered here. The Prisma twin runs the
 * same operations against a real database in
 * `github-installations.persistence.integration.test.ts` (the unique-index race
 * `insertOrGetExisting` is built on) and in
 * `../../__tests__/github-pull-request-mapping.persistence.integration.test.ts`
 * (the claim and the snapshot guard), because both statements are raw SQL whose
 * behaviour only Postgres can answer for. This suite pins the twin to the same
 * observable answers so the app can be driven without a database.
 */
import { Temporal, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { GithubRepositories } from "../github.repositories.ts";
import { MemoryGithubRepositories } from "../memory/memory.github.repositories.ts";

const ORGANIZATION = "organization-1";
const OTHER_ORGANIZATION = "organization-2";
const HOST = "github.com";
const REPOSITORY = "acme/widgets";
const BRANCH = "feat/one";

const at = (iso: string): Instant => Temporal.Instant.from(iso);
const NOW = at("2026-01-01T12:00:00Z");
const MINUTE = 60_000;

const backends: ReadonlyArray<Readonly<{ name: string; create: () => GithubRepositories }>> = [
  { name: "memory", create: () => MemoryGithubRepositories.create() },
];

function branchKey() {
  return {
    organizationId: ORGANIZATION,
    repositoryHost: HOST,
    repositoryFullName: REPOSITORY,
    headBranch: BRANCH,
  };
}

function pullRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationId: ORGANIZATION,
    repositoryHost: HOST,
    repositoryFullName: REPOSITORY,
    headBranch: BRANCH,
    prNumber: 7,
    htmlUrl: "https://github.com/acme/widgets/pull/7",
    title: "Add the widget",
    state: "open",
    isDraft: false,
    authorLogin: "sam",
    prCreatedAt: at("2026-01-01T10:00:00Z"),
    prClosedAt: null,
    prMergedAt: null,
    prUpdatedAt: at("2026-01-01T11:00:00Z"),
    ...overrides,
  } as Parameters<GithubRepositories["pullRequests"]["upsertPullRequests"]>[0]["pullRequests"][0];
}

describe.each(backends)("given the $name GitHub repositories", ({ create }) => {
  let repositories: GithubRepositories;

  beforeEach(() => {
    repositories = create();
  });

  describe("when the same installation id is claimed twice", () => {
    it("hands the second caller the first caller's committed row", async () => {
      const input = {
        installationId: "install-1",
        organizationId: ORGANIZATION,
        accountLogin: "acme",
        accountType: "Organization",
        accountId: "9000",
        repositorySelection: "all",
        repositories: null,
      };

      const first = await repositories.installations.insertOrGetExisting(input);
      const second = await repositories.installations.insertOrGetExisting({
        ...input,
        organizationId: OTHER_ORGANIZATION,
      });

      expect(first.wasInserted).toBe(true);
      expect(second.wasInserted).toBe(false);
      expect(second.row.organizationId).toBe(ORGANIZATION);
    });
  });

  describe("when an installation is suspended and then read back", () => {
    it("reports the suspension on the organization's own row only", async () => {
      await repositories.installations.upsert({
        installationId: "install-1",
        organizationId: ORGANIZATION,
        accountLogin: "acme",
        accountType: "Organization",
        accountId: "9000",
        repositorySelection: "selected",
        repositories: [{ id: "1", fullName: REPOSITORY }],
      });

      await repositories.installations.setSuspended({
        installationId: "install-1",
        suspended: true,
      });
      const rows = await repositories.installations.findAllForOrganization(ORGANIZATION);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.suspendedAt).not.toBeNull();
      expect(await repositories.installations.findAllForOrganization(OTHER_ORGANIZATION)).toEqual(
        [],
      );
    });
  });

  describe("when an older snapshot of a pull request arrives late", () => {
    it("keeps the stored snapshot and accepts an equal one", async () => {
      await repositories.pullRequests.upsertPullRequests({
        pullRequests: [pullRequest({ state: "closed", prUpdatedAt: at("2026-01-01T11:00:00Z") })],
      });

      await repositories.pullRequests.upsertPullRequests({
        pullRequests: [pullRequest({ state: "open", prUpdatedAt: at("2026-01-01T10:30:00Z") })],
      });
      const afterOlder = await repositories.pullRequests.findByNumber({
        organizationId: ORGANIZATION,
        repositoryHost: HOST,
        repositoryFullName: REPOSITORY,
        prNumber: 7,
      });

      expect(afterOlder?.state).toBe("closed");

      await repositories.pullRequests.upsertPullRequests({
        pullRequests: [pullRequest({ state: "open", prUpdatedAt: at("2026-01-01T11:00:00Z") })],
      });
      const afterEqual = await repositories.pullRequests.findByNumber({
        organizationId: ORGANIZATION,
        repositoryHost: HOST,
        repositoryFullName: REPOSITORY,
        prNumber: 7,
      });

      expect(afterEqual?.state).toBe("open");
    });
  });

  describe("when a repository is named in a different casing", () => {
    it("reads back the row the first casing wrote", async () => {
      await repositories.pullRequests.upsertPullRequests({ pullRequests: [pullRequest()] });

      const found = await repositories.pullRequests.findAllByBranches({
        organizationId: ORGANIZATION,
        repositoryHost: "GitHub.com",
        repositoryFullName: "Acme/Widgets",
        headBranches: [BRANCH],
      });

      expect(found).toHaveLength(1);
      expect(found[0]?.prNumber).toBe(7);
    });
  });

  describe("when two callers race for one branch lookup", () => {
    it("gives the claim to one of them and refuses the other until the lease elapses", async () => {
      const claim = {
        ...branchKey(),
        now: NOW,
        freshMappingMs: 10 * MINUTE,
        leaseMs: MINUTE,
        shouldRecordDemand: true,
      };

      expect(await repositories.pullRequests.claimBranchLookup(claim)).toBe(true);
      expect(await repositories.pullRequests.claimBranchLookup(claim)).toBe(false);
      expect(
        await repositories.pullRequests.claimBranchLookup({
          ...claim,
          now: NOW.add({ milliseconds: 2 * MINUTE }),
        }),
      ).toBe(true);
    });

    it("leaves the demand stamp alone for a caller that is not demand", async () => {
      await repositories.pullRequests.claimBranchLookup({
        ...branchKey(),
        now: NOW,
        freshMappingMs: 10 * MINUTE,
        leaseMs: MINUTE,
        shouldRecordDemand: true,
      });

      const later = NOW.add({ milliseconds: 2 * MINUTE });
      await repositories.pullRequests.claimBranchLookup({
        ...branchKey(),
        now: later,
        freshMappingMs: 10 * MINUTE,
        leaseMs: MINUTE,
        shouldRecordDemand: false,
      });
      const stored = await repositories.pullRequests.tryFindBranchCheck(branchKey());

      expect(stored?.lastRequestedAt.epochMilliseconds).toBe(NOW.epochMilliseconds);
    });
  });

  describe("when the sweep asks which branches are due", () => {
    it("takes the unmapped branches past their backoff that a reader still asks about", async () => {
      await repositories.pullRequests.upsertBranchCheck({
        ...branchKey(),
        lastCheckedAt: NOW.subtract({ milliseconds: 30 * MINUTE }),
        prCount: 0,
        notFoundAt: NOW.subtract({ milliseconds: 30 * MINUTE }),
        recheckAfter: NOW.subtract({ milliseconds: MINUTE }),
        attempts: 1,
        lastRequestedAt: NOW.subtract({ milliseconds: 5 * MINUTE }),
      });
      await repositories.pullRequests.upsertBranchCheck({
        ...branchKey(),
        headBranch: "feat/quiet",
        lastCheckedAt: NOW.subtract({ milliseconds: 30 * MINUTE }),
        prCount: 0,
        notFoundAt: NOW.subtract({ milliseconds: 30 * MINUTE }),
        recheckAfter: NOW.subtract({ milliseconds: MINUTE }),
        attempts: 1,
        lastRequestedAt: NOW.subtract({ milliseconds: 60 * MINUTE }),
      });

      const due = await repositories.pullRequests.findRecheckDue({
        now: NOW,
        activeWithinMs: 10 * MINUTE,
        limit: 10,
      });

      expect(due.map((row) => row.headBranch)).toEqual([BRANCH]);
    });
  });

  describe("when the retention sweep runs", () => {
    it("drops the bookkeeping past the horizon and keeps the pull requests", async () => {
      await repositories.pullRequests.upsertPullRequests({ pullRequests: [pullRequest()] });
      await repositories.pullRequests.upsertBranchCheck({
        ...branchKey(),
        lastCheckedAt: NOW.subtract({ milliseconds: 60 * MINUTE }),
        prCount: 1,
        notFoundAt: null,
        recheckAfter: null,
        attempts: 0,
        lastRequestedAt: NOW.subtract({ milliseconds: 60 * MINUTE }),
      });

      const deleted = await repositories.pullRequests.deleteStaleBefore({
        before: NOW.subtract({ milliseconds: 30 * MINUTE }),
      });

      expect(deleted).toEqual({ branchChecks: 1 });
      expect(await repositories.pullRequests.tryFindBranchCheck(branchKey())).toBeNull();
      expect(
        await repositories.pullRequests.findByNumber({
          organizationId: ORGANIZATION,
          repositoryHost: HOST,
          repositoryFullName: REPOSITORY,
          prNumber: 7,
        }),
      ).not.toBeNull();
    });
  });
});
