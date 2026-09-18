/**
 * @vitest-environment node
 * @unit
 *
 * The tenure rule, exhaustively: a session attaches to the first pull request
 * on its branch whose life had not ended when the session started, and a
 * session that drove several branches is asked once per branch.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 * @see specs/coding-agent/session-git-context.feature
 */
import { describe, expect, it } from "vitest";
import {
  type AssignablePullRequest,
  type AssignableSession,
  assignDrivingSessionsToPullRequests,
  assignSessionsToPullRequests,
  branchesOf,
} from "../pull-request-assignment";

const HOUR = 60 * 60 * 1000;
const base = Date.UTC(2026, 0, 1);

function session(
  over: Partial<AssignableSession> & { sessionId: string },
): AssignableSession {
  return {
    startedAtMs: base,
    headBranch: "feat/linkage",
    ...over,
  };
}

function pullRequest(
  over: Partial<AssignablePullRequest> & { prNumber: number },
): AssignablePullRequest {
  return {
    headBranch: "feat/linkage",
    prCreatedAtMs: base,
    prClosedAtMs: null,
    prMergedAtMs: null,
    ...over,
  };
}

describe("assignSessionsToPullRequests", () => {
  describe("given a branch whose pull request opened between two sessions", () => {
    /** @scenario "Sessions before and during a pull request both attach to it" */
    it("attaches both the earlier and the later session to it", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "before", startedAtMs: base }),
          session({ sessionId: "during", startedAtMs: base + 5 * HOUR }),
        ],
        pullRequests: [
          pullRequest({ prNumber: 41, prCreatedAtMs: base + 2 * HOUR }),
        ],
      });

      expect(assignments.get("before")).toBe(41);
      expect(assignments.get("during")).toBe(41);
    });
  });

  describe("given a branch that hosted a merged pull request and later a new one", () => {
    /** @scenario "A recycled branch splits sessions between its pull requests" */
    it("splits the sessions between the two eras", () => {
      const merged = pullRequest({
        prNumber: 10,
        prCreatedAtMs: base,
        prClosedAtMs: base + 10 * HOUR,
        prMergedAtMs: base + 10 * HOUR,
      });
      const successor = pullRequest({
        prNumber: 11,
        prCreatedAtMs: base + 20 * HOUR,
      });

      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "first-era", startedAtMs: base + 3 * HOUR }),
          session({ sessionId: "second-era", startedAtMs: base + 30 * HOUR }),
        ],
        pullRequests: [successor, merged],
      });

      expect(assignments.get("first-era")).toBe(10);
      expect(assignments.get("second-era")).toBe(11);
    });

    it("attaches a session that ran between the two to the successor", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "gap", startedAtMs: base + 15 * HOUR }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 10,
            prCreatedAtMs: base,
            prClosedAtMs: base + 10 * HOUR,
            prMergedAtMs: base + 10 * HOUR,
          }),
          pullRequest({ prNumber: 11, prCreatedAtMs: base + 20 * HOUR }),
        ],
      });

      expect(assignments.get("gap")).toBe(11);
    });
  });

  describe("given a branch with several pull requests over time", () => {
    /** @scenario "A session maps to at most one pull request" */
    it("counts each session under a single pull request", () => {
      const sessions = [
        session({ sessionId: "a", startedAtMs: base + HOUR }),
        session({ sessionId: "b", startedAtMs: base + 12 * HOUR }),
        session({ sessionId: "c", startedAtMs: base + 26 * HOUR }),
      ];
      const assignments = assignSessionsToPullRequests({
        sessions,
        pullRequests: [
          pullRequest({
            prNumber: 1,
            prCreatedAtMs: base,
            prClosedAtMs: base + 5 * HOUR,
          }),
          pullRequest({
            prNumber: 2,
            prCreatedAtMs: base + 6 * HOUR,
            prClosedAtMs: base + 20 * HOUR,
            prMergedAtMs: base + 20 * HOUR,
          }),
          pullRequest({ prNumber: 3, prCreatedAtMs: base + 24 * HOUR }),
        ],
      });

      expect([...assignments.entries()].sort()).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
      // One entry per session: the map key IS the "at most one" guarantee.
      expect(assignments.size).toBe(sessions.length);
    });
  });

  describe("given a session after the last pull request on its branch closed", () => {
    it("attaches it to nothing", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "orphan", startedAtMs: base + 50 * HOUR }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 7,
            prCreatedAtMs: base,
            prClosedAtMs: base + 10 * HOUR,
          }),
        ],
      });

      expect(assignments.has("orphan")).toBe(false);
    });
  });

  describe("given a pull request that was closed without merging", () => {
    it("ends its tenure at the close", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "inside", startedAtMs: base + HOUR }),
          session({ sessionId: "outside", startedAtMs: base + 9 * HOUR }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 5,
            prCreatedAtMs: base,
            prClosedAtMs: base + 4 * HOUR,
            prMergedAtMs: null,
          }),
        ],
      });

      expect(assignments.get("inside")).toBe(5);
      expect(assignments.has("outside")).toBe(false);
    });

    it("ends it at the merge time when only that is recorded", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "outside", startedAtMs: base + 9 * HOUR }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 6,
            prCreatedAtMs: base,
            prClosedAtMs: null,
            prMergedAtMs: base + 4 * HOUR,
          }),
        ],
      });

      expect(assignments.has("outside")).toBe(false);
    });
  });

  describe("given a session starting exactly when a pull request ended", () => {
    it("attaches it to that pull request", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "edge", startedAtMs: base + 4 * HOUR }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 8,
            prCreatedAtMs: base,
            prClosedAtMs: base + 4 * HOUR,
          }),
        ],
      });

      expect(assignments.get("edge")).toBe(8);
    });
  });

  describe("given pull requests on other branches", () => {
    it("never attaches a session across branches", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "mine", headBranch: "feat/mine" })],
        pullRequests: [pullRequest({ prNumber: 3, headBranch: "feat/theirs" })],
      });

      expect(assignments.has("mine")).toBe(false);
    });
  });

  describe("given two pull requests created in the same instant", () => {
    it("orders them by number so the assignment is stable", () => {
      const first = pullRequest({
        prNumber: 20,
        prCreatedAtMs: base,
        prClosedAtMs: base + HOUR,
      });
      const second = pullRequest({ prNumber: 21, prCreatedAtMs: base });

      const forward = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "s", startedAtMs: base })],
        pullRequests: [first, second],
      });
      const reversed = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "s", startedAtMs: base })],
        pullRequests: [second, first],
      });

      expect(forward.get("s")).toBe(20);
      expect(reversed.get("s")).toBe(20);
    });
  });

  describe("given no pull requests at all", () => {
    it("assigns nothing", () => {
      const assignments = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "lonely" })],
        pullRequests: [],
      });

      expect(assignments.size).toBe(0);
    });
  });
});

describe("assignDrivingSessionsToPullRequests", () => {
  describe("given a session that landed one branch and moved to another", () => {
    it("counts it toward the pull request of the branch it left", () => {
      const assignments = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "moved",
            startedAtMs: base,
            headBranches: ["feat/first", "feat/second"],
          },
        ],
        pullRequests: [pullRequest({ prNumber: 7, headBranch: "feat/first" })],
      });

      expect(assignments.get("moved")).toBe(7);
    });
  });

  describe("given a session driving two branches that each have a live pull request", () => {
    /** @scenario "A session that drove two pull requests counts toward only one of them" */
    it("counts it toward the one it opened first and toward the other not at all", () => {
      const assignments = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "both",
            startedAtMs: base,
            headBranches: ["feat/second", "feat/first"],
          },
        ],
        pullRequests: [
          pullRequest({
            prNumber: 21,
            headBranch: "feat/second",
            prCreatedAtMs: base + 2 * HOUR,
          }),
          pullRequest({
            prNumber: 9,
            headBranch: "feat/first",
            prCreatedAtMs: base + HOUR,
          }),
        ],
      });

      expect(assignments.get("both")).toBe(9);
      expect([...assignments.values()]).toEqual([9]);
    });

    it("answers the same however the branches arrived", () => {
      const pullRequests = [
        pullRequest({
          prNumber: 9,
          headBranch: "feat/first",
          prCreatedAtMs: base + HOUR,
        }),
        pullRequest({
          prNumber: 21,
          headBranch: "feat/second",
          prCreatedAtMs: base + 2 * HOUR,
        }),
      ];
      const forward = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "s",
            startedAtMs: base,
            headBranches: ["feat/first", "feat/second"],
          },
        ],
        pullRequests,
      });
      const reversed = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "s",
            startedAtMs: base,
            headBranches: ["feat/second", "feat/first"],
          },
        ],
        pullRequests,
      });

      expect(forward.get("s")).toBe(9);
      expect(reversed.get("s")).toBe(9);
    });
  });

  describe("given a session whose earlier branch's pull request closed before it started", () => {
    it("skips that one and takes the branch still live for it", () => {
      const assignments = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "later",
            startedAtMs: base + 5 * HOUR,
            headBranches: ["feat/first", "feat/second"],
          },
        ],
        pullRequests: [
          pullRequest({
            prNumber: 9,
            headBranch: "feat/first",
            prCreatedAtMs: base,
            prClosedAtMs: base + HOUR,
            prMergedAtMs: base + HOUR,
          }),
          pullRequest({
            prNumber: 21,
            headBranch: "feat/second",
            prCreatedAtMs: base + 4 * HOUR,
          }),
        ],
      });

      expect(assignments.get("later")).toBe(21);
    });
  });

  describe("given a session with no branches at all", () => {
    it("assigns nothing", () => {
      const assignments = assignDrivingSessionsToPullRequests({
        sessions: [{ sessionId: "bare", startedAtMs: base, headBranches: [] }],
        pullRequests: [pullRequest({ prNumber: 7 })],
      });

      expect(assignments.size).toBe(0);
    });
  });
});

describe("branchesOf", () => {
  describe("given a row folded before the branch set existed", () => {
    /** @scenario "A session row from before the branch set column falls back to its one branch" */
    it("falls back to the one branch it does carry", () => {
      expect(branchesOf({ gitBranch: "feat/only", gitBranches: [] })).toEqual([
        "feat/only",
      ]);
      // A row that names no branch at all drove none, and says so.
      expect(branchesOf({ gitBranch: "", gitBranches: [] })).toEqual([]);
    });
  });

  describe("given a row that recorded the whole set", () => {
    it("answers every branch, first seen first", () => {
      expect(
        branchesOf({
          gitBranch: "feat/second",
          gitBranches: ["feat/first", "feat/second"],
        }),
      ).toEqual(["feat/first", "feat/second"]);
    });
  });
});
