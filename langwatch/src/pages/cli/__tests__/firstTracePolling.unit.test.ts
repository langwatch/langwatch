import { describe, expect, it } from "vitest";
import {
  FIRST_TRACE_POLL_INTERVAL_MS,
  resolveFirstTracePolling,
} from "../FirstTraceRedirect";

const base = {
  hasProject: true,
  redirecting: false,
  timedOut: false,
  alreadyHadTraces: false,
  sawNeverSynced: true,
  isVisible: true,
};

describe("resolveFirstTracePolling", () => {
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
    expect(resolveFirstTracePolling({ ...base, timedOut: true })).toEqual({
      enabled: false,
      refetchInterval: false,
    });
  });

  /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
  it("never polls a project known to already have traces", () => {
    expect(
      resolveFirstTracePolling({
        ...base,
        sawNeverSynced: false,
        alreadyHadTraces: true,
      }),
    ).toEqual({ enabled: false, refetchInterval: false });
  });

  /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
  it("stops while the redirect is underway and never runs without a project", () => {
    expect(resolveFirstTracePolling({ ...base, redirecting: true })).toEqual({
      enabled: false,
      refetchInterval: false,
    });
    expect(resolveFirstTracePolling({ ...base, hasProject: false })).toEqual({
      enabled: false,
      refetchInterval: false,
    });
    // Before the first read resolves we allow the single initial fetch but
    // no interval yet.
    expect(
      resolveFirstTracePolling({ ...base, sawNeverSynced: false }),
    ).toEqual({ enabled: true, refetchInterval: false });
  });
});
