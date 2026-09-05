/**
 * @vitest-environment node
 * @see specs/coding-agent/pull-request-linkage.feature
 * @see packages/features/coding-agent/specs/session-git-context.feature
 */
import { describe, expect, it } from "vitest";
import {
  CodingAgentPullRequestAssignmentService,
  type AssignablePullRequest,
  type AssignableSession,
} from "../coding-agent-pull-request-assignment.service";

const assignments = CodingAgentPullRequestAssignmentService.create();
const assignSessionsToPullRequests = assignments.assignSessions.bind(assignments);
const assignDrivingSessionsToPullRequests = assignments.assignDrivingSessions.bind(assignments);
const assignDrivingSessionsToPullRequestsPerBranch =
  assignments.assignDrivingSessionsPerBranch.bind(assignments);
const branchesOf = assignments.branchesOf.bind(assignments);

const HOUR = 60 * 60 * 1000;
const base = Date.UTC(2026, 0, 1);

function session(over: Partial<AssignableSession> & { sessionId: string }): AssignableSession {
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
      const result = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "before", startedAtMs: base }),
          session({ sessionId: "during", startedAtMs: base + 5 * HOUR }),
        ],
        pullRequests: [pullRequest({ prNumber: 41, prCreatedAtMs: base + 2 * HOUR })],
      });

      expect(result.get("before")).toBe(41);
      expect(result.get("during")).toBe(41);
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

      const result = assignSessionsToPullRequests({
        sessions: [
          session({ sessionId: "first-era", startedAtMs: base + 3 * HOUR }),
          session({ sessionId: "second-era", startedAtMs: base + 30 * HOUR }),
        ],
        pullRequests: [successor, merged],
      });

      expect(result.get("first-era")).toBe(10);
      expect(result.get("second-era")).toBe(11);
    });

    it("attaches a session that ran between the two to the successor", () => {
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "gap", startedAtMs: base + 15 * HOUR })],
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

      expect(result.get("gap")).toBe(11);
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
      const result = assignSessionsToPullRequests({
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

      expect([...result.entries()].sort()).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
      // One entry per session: the map key IS the "at most one" guarantee.
      expect(result.size).toBe(sessions.length);
    });
  });

  describe("given a session after the last pull request on its branch closed", () => {
    it("attaches it to nothing", () => {
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "orphan", startedAtMs: base + 50 * HOUR })],
        pullRequests: [
          pullRequest({
            prNumber: 7,
            prCreatedAtMs: base,
            prClosedAtMs: base + 10 * HOUR,
          }),
        ],
      });

      expect(result.has("orphan")).toBe(false);
    });
  });

  describe("given a pull request that was closed without merging", () => {
    it("ends its tenure at the close", () => {
      const result = assignSessionsToPullRequests({
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

      expect(result.get("inside")).toBe(5);
      expect(result.has("outside")).toBe(false);
    });

    it("ends it at the merge time when only that is recorded", () => {
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "outside", startedAtMs: base + 9 * HOUR })],
        pullRequests: [
          pullRequest({
            prNumber: 6,
            prCreatedAtMs: base,
            prClosedAtMs: null,
            prMergedAtMs: base + 4 * HOUR,
          }),
        ],
      });

      expect(result.has("outside")).toBe(false);
    });
  });

  describe("given a session starting exactly when a pull request ended", () => {
    it("attaches it to that pull request", () => {
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "edge", startedAtMs: base + 4 * HOUR })],
        pullRequests: [
          pullRequest({
            prNumber: 8,
            prCreatedAtMs: base,
            prClosedAtMs: base + 4 * HOUR,
          }),
        ],
      });

      expect(result.get("edge")).toBe(8);
    });
  });

  describe("given pull requests on other branches", () => {
    it("never attaches a session across branches", () => {
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "mine", headBranch: "feat/mine" })],
        pullRequests: [pullRequest({ prNumber: 3, headBranch: "feat/theirs" })],
      });

      expect(result.has("mine")).toBe(false);
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
      const result = assignSessionsToPullRequests({
        sessions: [session({ sessionId: "lonely" })],
        pullRequests: [],
      });

      expect(result.size).toBe(0);
    });
  });
});

describe("assignDrivingSessionsToPullRequests", () => {
  describe("given a session that landed one branch and moved to another", () => {
    it("counts it toward the pull request of the branch it left", () => {
      const result = assignDrivingSessionsToPullRequests({
        sessions: [
          {
            sessionId: "moved",
            startedAtMs: base,
            headBranches: ["feat/first", "feat/second"],
          },
        ],
        pullRequests: [pullRequest({ prNumber: 7, headBranch: "feat/first" })],
      });

      expect(result.get("moved")).toBe(7);
    });
  });

  describe("given a session driving two branches that each have a live pull request", () => {
    // The single-winner rule now prices only what has no finer record: the
    // unstamped bucket. Stamped tokens split through the per-branch rule below.
    it("counts it toward the one it opened first and toward the other not at all", () => {
      const result = assignDrivingSessionsToPullRequests({
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

      expect(result.get("both")).toBe(9);
      expect([...result.values()]).toEqual([9]);
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
      const result = assignDrivingSessionsToPullRequests({
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

      expect(result.get("later")).toBe(21);
    });
  });

  describe("given a session with no branches at all", () => {
    it("assigns nothing", () => {
      const result = assignDrivingSessionsToPullRequests({
        sessions: [{ sessionId: "bare", startedAtMs: base, headBranches: [] }],
        pullRequests: [pullRequest({ prNumber: 7 })],
      });

      expect(result.size).toBe(0);
    });
  });
});

describe("assignDrivingSessionsToPullRequestsPerBranch", () => {
  describe("given a session driving two branches that each have a live pull request", () => {
    it("answers with each branch's own winner", () => {
      const result = assignDrivingSessionsToPullRequestsPerBranch({
        sessions: [
          {
            sessionId: "both",
            startedAtMs: base,
            headBranches: ["feat/first", "feat/second"],
          },
        ],
        pullRequests: [
          pullRequest({ prNumber: 9, headBranch: "feat/first" }),
          pullRequest({ prNumber: 21, headBranch: "feat/second" }),
        ],
      });

      const perBranch = result.get("both");
      expect(perBranch?.get("feat/first")).toBe(9);
      expect(perBranch?.get("feat/second")).toBe(21);
    });
  });

  describe("given a recycled branch with an old and a new pull request", () => {
    /** @scenario "Two pull requests on one branch split by era, not by double counting" */
    it("answers with the branch's tenure winner alone", () => {
      const result = assignDrivingSessionsToPullRequestsPerBranch({
        sessions: [
          {
            sessionId: "later-era",
            startedAtMs: base + 5 * HOUR,
            headBranches: ["feat/linkage"],
          },
        ],
        pullRequests: [
          pullRequest({
            prNumber: 9,
            prCreatedAtMs: base,
            prClosedAtMs: base + HOUR,
            prMergedAtMs: base + HOUR,
          }),
          pullRequest({ prNumber: 21, prCreatedAtMs: base + 4 * HOUR }),
        ],
      });

      expect(result.get("later-era")?.get("feat/linkage")).toBe(21);
    });
  });

  describe("given a session whose branches map to no pull request", () => {
    it("leaves the session out of the answer entirely", () => {
      const result = assignDrivingSessionsToPullRequestsPerBranch({
        sessions: [
          {
            sessionId: "unlinked",
            startedAtMs: base,
            headBranches: ["feat/nowhere"],
          },
        ],
        pullRequests: [pullRequest({ prNumber: 7 })],
      });

      expect(result.has("unlinked")).toBe(false);
    });
  });
});

describe("branchesOf", () => {
  describe("given a row folded before the branch set existed", () => {
    /** @scenario "A session row from before the branch set column falls back to its one branch" */
    it("falls back to the one branch it does carry", () => {
      expect(branchesOf({ gitBranch: "feat/only", gitBranches: [] })).toEqual(["feat/only"]);
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
