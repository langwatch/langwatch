/**
 * @vitest-environment node
 * @unit
 *
 * The tenure rule, exhaustively: a session attaches to the first pull request
 * on its branch whose life had not ended when the session started.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it } from "vitest";
import {
  type AssignablePullRequest,
  type AssignableSession,
  assignSessionsToPullRequests,
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
