/**
 * The usage report's pull request figure, over the memory twin.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryGithubRepositories } from "../memory.github.repositories.ts";

const opened = (organizationId: string, prNumber: number, at: string) => ({
  organizationId,
  repositoryHost: "github.com",
  repositoryFullName: "acme/app",
  headBranch: `branch-${prNumber}`,
  prNumber,
  htmlUrl: `https://github.com/acme/app/pull/${prNumber}`,
  title: "A change",
  state: "open",
  isDraft: false,
  authorLogin: null,
  prCreatedAt: Temporal.Instant.from(at),
  prClosedAt: null,
  prMergedAt: null,
  prUpdatedAt: Temporal.Instant.from(at),
});

describe("given pull requests across the install", () => {
  describe("when the usage report counts them", () => {
    it("counts the named organizations only, windowed on the day GitHub opened them", async () => {
      const repositories = MemoryGithubRepositories.create();
      await repositories.pullRequests.upsertPullRequests({
        pullRequests: [
          opened("org-1", 1, "2026-08-01T00:00:00Z"),
          opened("org-1", 2, "2026-09-20T00:00:00Z"),
          opened("org-2", 3, "2026-09-20T00:00:00Z"),
        ],
      });

      const lifetime = await repositories.pullRequests.countUsage({ organizationIds: ["org-1"] });
      const recent = await repositories.pullRequests.countUsage({
        organizationIds: ["org-1"],
        since: Date.parse("2026-09-14T00:00:00Z"),
      });

      expect(lifetime).toEqual({ pullRequests: 2 });
      expect(recent).toEqual({ pullRequests: 1 });
    });
  });
});
