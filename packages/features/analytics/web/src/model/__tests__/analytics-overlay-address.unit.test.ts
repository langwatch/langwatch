/**
 * The address a row writes when it opens the trace behind it.
 *
 * The overlay it names is `platform/app`'s and is mounted by chrome a packaged
 * screen has nothing above it to supply, so nothing opens yet — which is
 * exactly why the ADDRESS is what has to be pinned. It is what makes the
 * overlay come back for free when the chrome layout route lands, and it is what
 * a shared link already means.
 */

import { describe, expect, it } from "vitest";

import { traceDetailsAddress } from "../analytics-overlay-address";

describe("the trace overlay address", () => {
  describe("given a page with a range and a filter on the address", () => {
    describe("when a feedback row is opened", () => {
      /** @scenario "Opening a trace from the feedback table writes the overlay address" */
      it("names the drawer and the trace", () => {
        const next = traceDetailsAddress({
          current: { period: "7d", origin: "api" },
          traceId: "trace-1",
        });

        expect(next["drawer.open"]).toBe("traceV2Details");
        expect(next["drawer.traceId"]).toBe("trace-1");
      });

      it("leaves the page's own parameters standing underneath it", () => {
        const next = traceDetailsAddress({
          current: { period: "7d", origin: "api" },
          traceId: "trace-1",
        });

        expect(next.period).toBe("7d");
        expect(next.origin).toBe("api");
      });
    });
  });

  describe("given an address that already carries another overlay", () => {
    describe("when a different trace is opened", () => {
      /**
       * Every `drawer.` key comes off first, which is what the platform
       * registry did. Without it a stale parameter from the previous overlay
       * rides along and the new one opens holding the old one's data.
       */
      /** @scenario "Opening a second overlay clears the first one's parameters" */
      it("clears every parameter the previous overlay left behind", () => {
        const next = traceDetailsAddress({
          current: {
            "drawer.open": "addDatasetRecord",
            "drawer.selectedTraceIds": "trace-9",
            period: "7d",
          },
          traceId: "trace-1",
        });

        expect(next["drawer.open"]).toBe("traceV2Details");
        expect(next["drawer.selectedTraceIds"]).toBeUndefined();
        expect(next.period).toBe("7d");
      });
    });
  });
});
