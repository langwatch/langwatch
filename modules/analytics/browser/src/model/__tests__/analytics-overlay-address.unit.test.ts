/**
 * The address a row writes to open the trace behind it. The overlay itself
 * is `platform/app`'s and nothing here can mount it, so the ADDRESS is
 * what must be pinned — it's what a shared link already means.
 */

import { describe, expect, it } from "vitest";

import { automationDrawerAddress, traceDetailsAddress } from "../analytics-overlay-address.ts";

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

describe("the automation drawer address", () => {
  describe("given a graph's alert is being authored over a stale overlay", () => {
    it("names automation's drawer with the graph and alert, and clears the old keys", () => {
      const next = automationDrawerAddress({
        current: { "drawer.open": "traceV2Details", "drawer.traceId": "trace-9", period: "7d" },
        graphId: "graph_1",
        automationId: "trigger_1",
      });

      expect(next).toEqual({
        "drawer.open": "automation",
        "drawer.traceId": undefined,
        "drawer.automationId": "trigger_1",
        "drawer.prefilledGraphId": "graph_1",
        "drawer.prefilledSeriesName": undefined,
        period: "7d",
      });
    });
  });
});
