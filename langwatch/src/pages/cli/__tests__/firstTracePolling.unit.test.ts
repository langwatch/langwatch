import { describe, expect, it } from "vitest";
import {
  FIRST_TRACE_POLL_INTERVAL_MS,
  resolveFirstTracePolling,
} from "../FirstTraceRedirect";

const base = {
  hasProject: true,
  hasResult: true,
  isRedirecting: false,
  isTimedOut: false,
  hasPriorTraces: false,
  hasSeenNeverSynced: true,
  isVisible: true,
};

describe("resolveFirstTracePolling", () => {
  describe("when the never-synced state is confirmed", () => {
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("polls on the interval only while the tab is visible", () => {
      expect(resolveFirstTracePolling(base)).toEqual({
        enabled: true,
        refetchInterval: FIRST_TRACE_POLL_INTERVAL_MS,
      });
      expect(resolveFirstTracePolling({ ...base, isVisible: false })).toEqual({
        enabled: true,
        refetchInterval: false,
      });
    });

    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("stops entirely at the timeout", () => {
      expect(resolveFirstTracePolling({ ...base, isTimedOut: true })).toEqual({
        enabled: false,
        refetchInterval: false,
      });
    });
  });

  describe("when the watch has concluded", () => {
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("never polls a project known to already have traces", () => {
      expect(
        resolveFirstTracePolling({
          ...base,
          hasSeenNeverSynced: false,
          hasPriorTraces: true,
        }),
      ).toEqual({ enabled: false, refetchInterval: false });
    });

    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("stops while the redirect is underway and never runs without a project", () => {
      expect(
        resolveFirstTracePolling({ ...base, isRedirecting: true }),
      ).toEqual({ enabled: false, refetchInterval: false });
      expect(resolveFirstTracePolling({ ...base, hasProject: false })).toEqual({
        enabled: false,
        refetchInterval: false,
      });
    });
  });

  describe("when no result has arrived yet", () => {
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("keeps retrying the initial read until the timeout, so a failed fetch cannot stall the watch", () => {
      expect(
        resolveFirstTracePolling({
          ...base,
          hasResult: false,
          hasSeenNeverSynced: false,
        }),
      ).toEqual({
        enabled: true,
        refetchInterval: FIRST_TRACE_POLL_INTERVAL_MS,
      });
      expect(
        resolveFirstTracePolling({
          ...base,
          hasResult: false,
          hasSeenNeverSynced: false,
          isTimedOut: true,
        }),
      ).toEqual({ enabled: false, refetchInterval: false });
    });
  });
});
