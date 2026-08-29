import { describe, expect, it } from "vitest";
import type { OpsQueueGroup } from "../index";
import {
  classifyGroup,
  describeNextRun,
  matchesStatusFilter,
  sortGroupsBySeverity,
} from "../index";

const NOW = 1_755_100_000_000;

function makeGroup(overrides: Partial<OpsQueueGroup> = {}): OpsQueueGroup {
  return {
    groupId: "project_a/map/spanStorage/span-map:1",
    pendingJobs: 1,
    score: NOW - 1_000,
    hasActiveJob: false,
    activeJobId: null,
    isBlocked: false,
    oldestJobMs: NOW - 60_000,
    newestJobMs: NOW - 5_000,
    isStaleBlock: false,
    pipelineName: "spanStorage",
    jobType: "map",
    jobName: "span-map",
    errorMessage: null,
    errorStack: null,
    errorTimestamp: null,
    retryCount: null,
    activeKeyTtlSec: null,
    processingDurationMs: null,
    ...overrides,
  };
}

describe("classifyGroup", () => {
  describe("given a group whose last attempt failed", () => {
    describe("when its next attempt is deferred into the future", () => {
      // The re-stage keeps the active key alive for the backoff window, so
      // hasActiveJob is true here — exactly the shape that used to read as a
      // healthy "Active" row.
      const group = makeGroup({
        retryCount: 2,
        errorMessage: "connect ECONNREFUSED",
        errorTimestamp: NOW - 3_000,
        score: NOW + 30_000,
        hasActiveJob: true,
        activeKeyTtlSec: 30,
      });

      /** @scenario "A group waiting out a retry backoff reads as retrying" */
      it("classifies it as retrying, not active, and carries the next attempt time", () => {
        const c = classifyGroup(group, NOW);
        expect(c.state).toBe("retrying");
        expect(c.nextEligibleMs).toBe(NOW + 30_000);
        expect(c.attempt).toBe(2);
      });

      /** @scenario "A group that keeps failing is marked as failing" */
      it("marks it as failing", () => {
        expect(classifyGroup(group, NOW).isFailing).toBe(true);
      });
    });
  });

  describe("given a group whose only recorded error is old and never retried", () => {
    /** @scenario "A stale error does not mark a healthy group as failing" */
    it("does not mark it as failing", () => {
      const c = classifyGroup(
        makeGroup({
          errorMessage: "one-off timeout",
          errorTimestamp: NOW - 16 * 60 * 1000,
          retryCount: 0,
        }),
        NOW,
      );
      expect(c.isFailing).toBe(false);
    });

    it("still marks a RECENT un-retried error as failing", () => {
      const c = classifyGroup(
        makeGroup({
          errorMessage: "one-off timeout",
          errorTimestamp: NOW - 30_000,
          retryCount: 0,
        }),
        NOW,
      );
      expect(c.isFailing).toBe(true);
    });
  });

  describe("given two queued groups", () => {
    describe("when one is eligible now and the other is deferred", () => {
      /** @scenario "Work due now is distinguished from work deferred into the future" */
      it("reads the eligible one as due and the deferred one as scheduled with its time", () => {
        const due = classifyGroup(makeGroup({ pendingJobs: 3, score: NOW - 500 }), NOW);
        const deferred = classifyGroup(
          makeGroup({ pendingJobs: 3, score: NOW + 120_000 }),
          NOW,
        );
        expect(due.state).toBe("due");
        expect(deferred.state).toBe("scheduled");
        expect(deferred.nextEligibleMs).toBe(NOW + 120_000);
      });
    });
  });

  describe("given a group with an active job and no failures", () => {
    it("classifies it as active", () => {
      const c = classifyGroup(
        makeGroup({ hasActiveJob: true, activeJobId: "job-1" }),
        NOW,
      );
      expect(c.state).toBe("active");
      expect(c.isFailing).toBe(false);
    });
  });

  describe("given a group with nothing pending and nothing active", () => {
    it("classifies it as idle", () => {
      expect(classifyGroup(makeGroup({ pendingJobs: 0 }), NOW).state).toBe("idle");
    });
  });

  describe("given blocked-set groups", () => {
    it("classifies a blocked group with work as blocked", () => {
      expect(
        classifyGroup(makeGroup({ isBlocked: true, errorMessage: "poison" }), NOW).state,
      ).toBe("blocked");
    });

    it("classifies an empty blocked group as stale", () => {
      expect(
        classifyGroup(
          makeGroup({ isBlocked: true, isStaleBlock: true, pendingJobs: 0 }),
          NOW,
        ).state,
      ).toBe("stale");
    });
  });
});

describe("sortGroupsBySeverity", () => {
  describe("given blocked, retrying, due, active, and idle groups in one table", () => {
    const idle = makeGroup({ groupId: "g/idle", pendingJobs: 0 });
    const active = makeGroup({
      groupId: "g/active",
      hasActiveJob: true,
      activeJobId: "j1",
    });
    const blocked = makeGroup({
      groupId: "g/blocked",
      isBlocked: true,
      errorMessage: "poison",
    });
    const retrying = makeGroup({
      groupId: "g/retrying",
      retryCount: 1,
      errorMessage: "flaky",
      score: NOW + 10_000,
    });
    const due = makeGroup({ groupId: "g/due", pendingJobs: 5 });

    describe("when the table orders its rows", () => {
      /** @scenario "Trouble sorts above healthy work" */
      it("puts blocked first and retrying before all healthy work", () => {
        const ordered = sortGroupsBySeverity(
          [idle, active, blocked, retrying, due],
          NOW,
        ).map((g) => g.groupId);
        expect(ordered[0]).toBe("g/blocked");
        expect(ordered.indexOf("g/retrying")).toBeLessThan(ordered.indexOf("g/due"));
        expect(ordered.indexOf("g/retrying")).toBeLessThan(ordered.indexOf("g/active"));
        expect(ordered.indexOf("g/retrying")).toBeLessThan(ordered.indexOf("g/idle"));
      });
    });

    it("breaks severity ties by pending depth", () => {
      const shallow = makeGroup({ groupId: "g/shallow", pendingJobs: 1 });
      const deep = makeGroup({ groupId: "g/deep", pendingJobs: 50 });
      const ordered = sortGroupsBySeverity([shallow, deep], NOW).map((g) => g.groupId);
      expect(ordered).toEqual(["g/deep", "g/shallow"]);
    });
  });
});

describe("describeNextRun", () => {
  it("says a retrying group's next attempt is in the future", () => {
    const c = classifyGroup(
      makeGroup({ retryCount: 1, errorMessage: "x", score: NOW + 30_000 }),
      NOW,
    );
    expect(describeNextRun(c, NOW)).toBe("in 30s");
  });

  it("says now for work that is dispatch-eligible", () => {
    const c = classifyGroup(makeGroup({ pendingJobs: 2 }), NOW);
    expect(describeNextRun(c, NOW)).toBe("now");
  });

  it("says running for an active group", () => {
    const c = classifyGroup(makeGroup({ hasActiveJob: true, activeJobId: "j" }), NOW);
    expect(describeNextRun(c, NOW)).toBe("running");
  });

  it("never renders a negative countdown when eligibility slipped past", () => {
    const c = classifyGroup(
      makeGroup({ retryCount: 1, errorMessage: "x", score: NOW + 5_000 }),
      NOW,
    );
    // Rendered 10 seconds later: the instant is in the past now.
    expect(describeNextRun(c, NOW + 10_000)).toBe("now");
  });

  it("shows a dash for a blocked group the dispatcher will not touch", () => {
    const c = classifyGroup(makeGroup({ isBlocked: true, errorMessage: "poison" }), NOW);
    expect(describeNextRun(c, NOW)).toBe("—");
  });
});

describe("matchesStatusFilter", () => {
  describe("when filtering for retrying", () => {
    it("matches a group waiting out backoff", () => {
      const g = makeGroup({
        retryCount: 1,
        errorMessage: "x",
        score: NOW + 10_000,
      });
      expect(matchesStatusFilter(g, "retrying", NOW)).toBe(true);
    });

    it("matches a failing group that is mid-reattempt", () => {
      const g = makeGroup({
        retryCount: 1,
        errorMessage: "x",
        hasActiveJob: true,
        score: NOW - 1_000,
      });
      expect(matchesStatusFilter(g, "retrying", NOW)).toBe(true);
    });

    it("does not match a blocked group", () => {
      const g = makeGroup({ isBlocked: true, errorMessage: "x" });
      expect(matchesStatusFilter(g, "retrying", NOW)).toBe(false);
    });
  });

  describe("when filtering for ok", () => {
    it("excludes failing groups", () => {
      const g = makeGroup({
        errorMessage: "x",
        errorTimestamp: NOW - 1_000,
      });
      expect(matchesStatusFilter(g, "ok", NOW)).toBe(false);
    });

    it("includes healthy queued work", () => {
      expect(matchesStatusFilter(makeGroup(), "ok", NOW)).toBe(true);
    });
  });
});
