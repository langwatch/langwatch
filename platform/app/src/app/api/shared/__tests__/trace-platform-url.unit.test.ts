/**
 * Trace links carry the trace's start time as the drawer's partition hint.
 *
 * @see specs/traces-v2/trace-drawer-shell.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: { BASE_HOST: "https://app.langwatch.ai" },
}));

import { tracePath, tracePlatformUrl } from "../trace-platform-url";

describe("tracePlatformUrl", () => {
  describe("when the trace's start time is known", () => {
    /** @scenario "A trace link built by the platform carries the trace timestamp" */
    it("appends it as the t parameter, in whole milliseconds", () => {
      expect(
        tracePlatformUrl({
          projectSlug: "acme",
          traceId: "trace-1",
          occurredAtMs: 1714476000000.7,
        }),
      ).toBe("https://app.langwatch.ai/acme/traces/trace-1?t=1714476000000");
    });
  });

  describe("when the start time is unknown or unusable", () => {
    it("links the bare trace path", () => {
      for (const occurredAtMs of [undefined, null, 0, -5, Number.NaN]) {
        expect(
          tracePlatformUrl({
            projectSlug: "acme",
            traceId: "trace-1",
            occurredAtMs,
          }),
        ).toBe("https://app.langwatch.ai/acme/traces/trace-1");
      }
    });
  });
});

describe("tracePath", () => {
  it("is the path the full link is built from", () => {
    expect(tracePath({ traceId: "trace-1", occurredAtMs: 1000 })).toBe(
      "/traces/trace-1?t=1000",
    );
    expect(tracePath({ traceId: "trace-1" })).toBe("/traces/trace-1");
  });
});
