/**
 * When the first-trace watch polls, and what a landing read means.
 *
 * Moved verbatim from `platform/app/src/pages/cli/__tests__/firstTracePolling.unit.test.ts`;
 * the only edit is the module path, which is now the pure policy rather than the
 * component that used to carry it.
 *
 * Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */
import { describe, expect, it } from "vitest";
import {
  FIRST_TRACE_POLL_INTERVAL_MS,
  resolveFirstTracePolling,
  resolveFirstTraceTransition,
} from "../first-trace-policy";

const base = {
  hasProject: true,
  hasResult: true,
  isRedirecting: false,
  isTimedOut: false,
  hasPriorTraces: false,
  hasSeenNeverSynced: true,
} as const;

describe("resolveFirstTracePolling", () => {
  describe("when the never-synced state is confirmed", () => {
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
    it("polls on the interval while the watch is live", () => {
      // Visible-tab-only is react-query's own default: with
      // refetchIntervalInBackground unset, interval refetches pause on a
      // hidden tab. The RTL suite pins that the option is never overridden.
      expect(resolveFirstTracePolling(base)).toEqual({
        enabled: true,
        refetchInterval: FIRST_TRACE_POLL_INTERVAL_MS,
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
      expect(resolveFirstTracePolling({ ...base, isRedirecting: true })).toEqual({
        enabled: false,
        refetchInterval: false,
      });
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

describe("resolveFirstTraceTransition", () => {
  describe("when reads land before the timeout", () => {
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
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
    /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
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
