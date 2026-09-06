import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commitsToResolve,
  landingCommits,
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

describe("given a push that landed more than one commit", () => {
  describe("when the commits to resolve are chosen", () => {
    /** @scenario "Every commit in the push is resolved, not just the tip" */
    it("resolves every commit in the range, tip included", () => {
      assert.deepEqual(
        commitsToResolve({ after: "ccc", compared: ["aaa", "bbb", "ccc"] }),
        ["aaa", "bbb", "ccc"],
      );
    });

    it("names the tip once when the range already ends there", () => {
      assert.deepEqual(commitsToResolve({ after: "ccc", compared: ["ccc"] }), [
        "ccc",
      ]);
    });

    /** @scenario "A push with no comparable range still resolves its tip" */
    it("falls back to the tip alone when there is no range", () => {
      // A branch creation, or a compare that could not be read.
      assert.deepEqual(commitsToResolve({ after: "ccc", compared: [] }), [
        "ccc",
      ]);
    });
  });
});

describe("given a pull request whose commits all landed in this push", () => {
  describe("when the landing commit for each pull request is chosen", () => {
    /** @scenario "A pull request is stamped with the commit it landed on" */
    it("takes the last of its commits, not the first", () => {
      // A rebase merge associates every one of a pull request's commits with
      // it, and compare lists them oldest first.
      const landed = landingCommits([
        { commit: "aaa", pullRequests: [pull({ number: 42 })] },
        { commit: "bbb", pullRequests: [pull({ number: 42 })] },
      ]);
      assert.equal(landed.get(42), "bbb");
    });

    /** @scenario "Each pull request in a batch keeps its own commit" */
    it("gives each pull request in a batch the commit that carried it", () => {
      const landed = landingCommits([
        { commit: "aaa", pullRequests: [pull({ number: 42 })] },
        { commit: "bbb", pullRequests: [pull({ number: 43 })] },
      ]);
      assert.equal(landed.get(42), "aaa");
      assert.equal(landed.get(43), "bbb");
    });

    it("names nothing for a commit that carried no pull request", () => {
      assert.equal(landingCommits([{ commit: "aaa", pullRequests: [] }]).size, 0);
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
