// First-trace watch polling: when to poll and what landing means. Moved from platform/app; now
// pure policy. Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
import { describe, expect, it } from "vitest";

import { resolveFirstTracePolling, resolveFirstTraceTransition } from "../first-trace-policy.ts";

const base = {
  hasProject: true,
  isRedirecting: false,
  isTimedOut: false,
  hasPriorTraces: false,
} as const;

describe("resolveFirstTracePolling", () => {
  describe("when the never-synced state is confirmed", () => {
    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("reads while the watch is live", () => {
      // The read is driven by a server hint, not a timer.
      expect(resolveFirstTracePolling(base)).toEqual({ enabled: true });
    });

    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("stops entirely at the timeout", () => {
      expect(resolveFirstTracePolling({ ...base, isTimedOut: true })).toEqual({ enabled: false });
    });
  });

  describe("when the watch has concluded", () => {
    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("never polls a project known to already have traces", () => {
      expect(
        resolveFirstTracePolling({
          ...base,
          hasPriorTraces: true,
        }),
      ).toEqual({ enabled: false });
    });

    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("stops while the redirect is underway and never runs without a project", () => {
      expect(resolveFirstTracePolling({ ...base, isRedirecting: true })).toEqual({
        enabled: false,
      });
      expect(resolveFirstTracePolling({ ...base, hasProject: false })).toEqual({ enabled: false });
    });
  });
});

describe("resolveFirstTraceTransition", () => {
  describe("when reads land before the timeout", () => {
    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("confirms never-synced once, keeps prior-trace projects on the current behavior, and redirects on the flip", () => {
      expect(
        resolveFirstTraceTransition({
          firstMessage: false,
          hasSeenNeverSynced: false,
          isTimedOut: false,
        }),
      ).toBe("confirm-never-synced");
      expect(
        resolveFirstTraceTransition({
          firstMessage: false,
          hasSeenNeverSynced: true,
          isTimedOut: false,
        }),
      ).toBe("none");
      expect(
        resolveFirstTraceTransition({
          firstMessage: true,
          hasSeenNeverSynced: false,
          isTimedOut: false,
        }),
      ).toBe("mark-prior-traces");
      expect(
        resolveFirstTraceTransition({
          firstMessage: true,
          hasSeenNeverSynced: true,
          isTimedOut: false,
        }),
      ).toBe("redirect");
      expect(
        resolveFirstTraceTransition({
          firstMessage: undefined,
          hasSeenNeverSynced: false,
          isTimedOut: false,
        }),
      ).toBe("none");
    });
  });

  describe("when a read lands after the watch timed out", () => {
    /** @scenario "First-trace reads stop at the timeout, once traces are known and during the redirect" */
    it("never starts a redirect, however late the response was", () => {
      expect(
        resolveFirstTraceTransition({
          firstMessage: true,
          hasSeenNeverSynced: true,
          isTimedOut: true,
        }),
      ).toBe("none");
    });
  });
});
