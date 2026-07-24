import { describe, expect, it } from "vitest";
import { routeTraceDrawerForV2 } from "../traceDrawerV2Routing";

describe("routeTraceDrawerForV2()", () => {
  describe("given the open is not on the legacy Traces page", () => {
    describe("when opening a trace's details with a trace id", () => {
      /** @scenario "The default applies to every trace entry point, not only the traces table" */
      it("routes to the Trace Explorer drawer, keeping only the trace id", () => {
        const routed = routeTraceDrawerForV2(
          "traceDetails",
          { traceId: "trace-1", selectedTab: "traceDetails" },
          false,
        );

        expect(routed.drawer).toBe("traceV2Details");
        expect(routed.props).toEqual({ traceId: "trace-1" });
      });

      it("forwards the partition-pruning timestamp hint when a caller has it", () => {
        const routed = routeTraceDrawerForV2(
          "traceDetails",
          { traceId: "trace-1", t: "1733600000000" },
          false,
        );

        expect(routed.drawer).toBe("traceV2Details");
        expect(routed.props).toEqual({
          traceId: "trace-1",
          t: "1733600000000",
        });
      });
    });

    describe("when opening a drawer that is not a trace", () => {
      /** @scenario "Opening a non-trace drawer is unaffected" */
      it("leaves it untouched", () => {
        const props = { promptId: "p-1" };

        const routed = routeTraceDrawerForV2("promptEditor", props, false);

        expect(routed.drawer).toBe("promptEditor");
        expect(routed.props).toBe(props);
      });
    });

    describe("when opening a trace's details without a trace id", () => {
      /** @scenario "A trace request without a trace id is left on the legacy drawer" */
      it("leaves it on the legacy drawer", () => {
        const props = { selectedTab: "traceDetails" };

        const routed = routeTraceDrawerForV2("traceDetails", props, false);

        expect(routed.drawer).toBe("traceDetails");
        expect(routed.props).toBe(props);
      });

      it("ignores a blank trace id", () => {
        const props = { traceId: "" };

        const routed = routeTraceDrawerForV2("traceDetails", props, false);

        expect(routed.drawer).toBe("traceDetails");
        expect(routed.props).toBe(props);
      });
    });
  });

  describe("given the open happens on the legacy Traces page", () => {
    describe("when opening a trace's details", () => {
      /** @scenario "Opening a trace from the legacy Traces page uses the legacy drawer" */
      it("keeps the legacy drawer so the page stays coherent", () => {
        const props = { traceId: "trace-1" };

        const routed = routeTraceDrawerForV2("traceDetails", props, true);

        expect(routed.drawer).toBe("traceDetails");
        expect(routed.props).toBe(props);
      });
    });
  });
});
