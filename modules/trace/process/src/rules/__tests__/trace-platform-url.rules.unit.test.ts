import { describe, expect, it } from "vitest";

import { tracePath, tracePlatformUrl } from "../trace-platform-url.rules.ts";

describe("tracePath", () => {
  describe("given a trace that started at 1714476000000", () => {
    /** @scenario A trace link built by the platform carries the trace timestamp */
    it("ends in the trace id and the start time as the partition hint", () => {
      const path = tracePath({ traceId: "trace-1", occurredAtMs: 1714476000000 });

      expect(path).toBe("/traces/trace-1?t=1714476000000");
      expect(
        tracePlatformUrl({
          publicBaseUrl: "https://app.example.test/",
          projectSlug: "demo",
          path,
        }),
      ).toBe("https://app.example.test/demo/traces/trace-1?t=1714476000000");
    });
  });

  describe("given a trace with no known start time", () => {
    /** @scenario A trace link built by the platform carries the trace timestamp */
    it.each([undefined, null, 0, -5, Number.NaN])(
      "links to the bare path for %s",
      (occurredAtMs) => {
        expect(tracePath({ traceId: "trace-1", occurredAtMs })).toBe("/traces/trace-1");
        expect(tracePath({ traceId: "trace-1" })).toBe("/traces/trace-1");
      },
    );
  });
});
