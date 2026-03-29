import { describe, expect, it } from "vitest";
import { matchesStatusFilter } from "../matchesStatusFilter.ts";
import type { GroupInfo } from "../../../../shared/types.ts";

function makeGroup(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    groupId: "g1",
    pendingJobs: 0,
    score: 1,
    hasActiveJob: false,
    activeJobId: null,
    isBlocked: false,
    oldestJobMs: null,
    newestJobMs: null,
    isStaleBlock: false,
    pipelineName: null,
    jobType: null,
    jobName: null,
    errorMessage: null,
    errorStack: null,
    errorTimestamp: null,
    retryCount: null,
    activeKeyTtlSec: null,
    processingDurationMs: null,
    ...overrides,
  };
}

describe("matchesStatusFilter", () => {
  describe("when filter is 'all'", () => {
    it("matches any group regardless of state", () => {
      expect(matchesStatusFilter(makeGroup(), "all")).toBe(true);
      expect(matchesStatusFilter(makeGroup({ isBlocked: true }), "all")).toBe(true);
      expect(matchesStatusFilter(makeGroup({ isStaleBlock: true }), "all")).toBe(true);
      expect(matchesStatusFilter(makeGroup({ hasActiveJob: true }), "all")).toBe(true);
    });
  });

  describe("when filter is 'ok'", () => {
    it("matches non-blocked non-stale groups", () => {
      expect(matchesStatusFilter(makeGroup(), "ok")).toBe(true);
    });

    it("rejects blocked groups", () => {
      expect(matchesStatusFilter(makeGroup({ isBlocked: true }), "ok")).toBe(false);
    });

    it("rejects stale groups", () => {
      expect(matchesStatusFilter(makeGroup({ isStaleBlock: true }), "ok")).toBe(false);
    });
  });

  describe("when filter is 'blocked'", () => {
    it("matches blocked non-stale groups", () => {
      expect(matchesStatusFilter(makeGroup({ isBlocked: true }), "blocked")).toBe(true);
    });

    it("rejects stale blocks since stale is a subset of blocked", () => {
      expect(
        matchesStatusFilter(makeGroup({ isBlocked: true, isStaleBlock: true }), "blocked")
      ).toBe(false);
    });

    it("rejects non-blocked groups", () => {
      expect(matchesStatusFilter(makeGroup(), "blocked")).toBe(false);
    });
  });

  describe("when filter is 'stale'", () => {
    it("matches groups with isStaleBlock true", () => {
      expect(
        matchesStatusFilter(makeGroup({ isBlocked: true, isStaleBlock: true }), "stale")
      ).toBe(true);
    });

    it("rejects non-stale groups", () => {
      expect(matchesStatusFilter(makeGroup({ isBlocked: true }), "stale")).toBe(false);
    });

    it("rejects non-blocked non-stale groups", () => {
      expect(matchesStatusFilter(makeGroup(), "stale")).toBe(false);
    });
  });

  describe("when filter is 'active'", () => {
    it("matches groups with active jobs that are not blocked", () => {
      expect(matchesStatusFilter(makeGroup({ hasActiveJob: true }), "active")).toBe(true);
    });

    it("rejects blocked active groups", () => {
      expect(
        matchesStatusFilter(makeGroup({ hasActiveJob: true, isBlocked: true }), "active")
      ).toBe(false);
    });

    it("rejects inactive groups", () => {
      expect(matchesStatusFilter(makeGroup(), "active")).toBe(false);
    });
  });
});
