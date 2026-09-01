import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeTargets,
  type AssociatedPullRequest,
} from "./pr-token-usage-merged.ts";

const pull = (
  overrides: Partial<AssociatedPullRequest> = {},
): AssociatedPullRequest => ({
  number: 42,
  merged_at: "2026-09-01T10:00:00Z",
  base: { ref: "main" },
  head: { repo: { full_name: "acme/widgets" } },
  ...overrides,
});

const targets = (pullRequests: AssociatedPullRequest[]) =>
  mergeTargets({ pullRequests, branch: "main", repository: "acme/widgets" });

describe("given a push to the default branch that merged a pull request", () => {
  describe("when the pull requests for the pushed commit are read", () => {
    /** @scenario "A merged pull request gets one last refresh" */
    it("names the pull request that merged into the pushed branch", () => {
      assert.deepEqual(targets([pull()]), { refresh: [42], forks: [] });
    });

    /** @scenario "A batch merge refreshes every pull request it carried" */
    it("names every merged pull request once, without repeats", () => {
      const result = targets([
        pull({ number: 42 }),
        pull({ number: 43 }),
        pull({ number: 42 }),
      ]);
      assert.deepEqual(result.refresh, [42, 43]);
    });
  });
});

describe("given a commit associated with pull requests that did not merge it", () => {
  describe("when the pull requests for the pushed commit are read", () => {
    /** @scenario "Only the pull requests that merged are refreshed" */
    it("passes over open pull requests and pull requests merged elsewhere", () => {
      // GitHub associates a commit with every pull request containing it.
      const openOne = pull({ number: 50, merged_at: null });
      const otherBranch = pull({ number: 51, base: { ref: "release/2.0" } });
      const result = targets([openOne, otherBranch, pull({ number: 52 })]);
      assert.deepEqual(result.refresh, [52]);
    });
  });
});

describe("given a merged pull request whose head branch is in another repository", () => {
  describe("when the pull requests for the pushed commit are read", () => {
    /** @scenario "A merged fork pull request is still not commented on" */
    it("reports it as a fork rather than refreshing it", () => {
      const result = targets([
        pull({ number: 60, head: { repo: { full_name: "contributor/widgets" } } }),
        // A deleted fork leaves no head repository at all.
        pull({ number: 61, head: { repo: null } }),
        pull({ number: 62 }),
      ]);
      assert.deepEqual(result.refresh, [62]);
      assert.deepEqual(result.forks, [60, 61]);
    });
  });
});

describe("given a direct push to the default branch", () => {
  describe("when the pull requests for the pushed commit are read", () => {
    /** @scenario "A push that merged nothing changes nothing" */
    it("names no pull request to refresh", () => {
      assert.deepEqual(targets([]), { refresh: [], forks: [] });
    });
  });
});
