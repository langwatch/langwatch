import { describe, expect, it } from "vitest";
import { routeTraceDrawerForV2 } from "../traceDrawerV2Routing";

describe("routeTraceDrawerForV2()", () => {
  describe("when the device has opted into traces v2", () => {
    /** @scenario "The opt-in applies to every trace entry point, not only the traces table" */
    it("routes a traceDetails open with a trace id to the v2 drawer, keeping only the id", () => {
      const routed = routeTraceDrawerForV2(
        "traceDetails",
        { traceId: "trace-1", selectedTab: "traceDetails" },
        true,
      );

      expect(routed.drawer).toBe("traceV2Details");
      expect(routed.props).toEqual({ traceId: "trace-1" });
    });

    it("forwards the partition-pruning timestamp hint when a caller has it", () => {
      const routed = routeTraceDrawerForV2(
        "traceDetails",
        { traceId: "trace-1", t: "1733600000000" },
        true,
      );

      expect(routed.drawer).toBe("traceV2Details");
      expect(routed.props).toEqual({ traceId: "trace-1", t: "1733600000000" });
    });

    /** @scenario "Opening a non-trace drawer is unaffected by the opt-in" */
    it("leaves a non-trace drawer untouched", () => {
      const props = { promptId: "p-1" };

      const routed = routeTraceDrawerForV2("promptEditor", props, true);

      expect(routed.drawer).toBe("promptEditor");
      expect(routed.props).toBe(props);
    });

    /** @scenario "A trace request without a trace id is left on the legacy drawer" */
    it("leaves a traceDetails open without a trace id on the legacy drawer", () => {
      const props = { selectedTab: "traceDetails" };

      const routed = routeTraceDrawerForV2("traceDetails", props, true);

      expect(routed.drawer).toBe("traceDetails");
      expect(routed.props).toBe(props);
    });

    it("ignores a blank trace id", () => {
      const props = { traceId: "" };

      const routed = routeTraceDrawerForV2("traceDetails", props, true);

      expect(routed.drawer).toBe("traceDetails");
      expect(routed.props).toBe(props);
    });
  });

  describe("when the device has not opted into traces v2", () => {
    it("leaves a traceDetails open on the legacy drawer", () => {
      const props = { traceId: "trace-1" };

      const routed = routeTraceDrawerForV2("traceDetails", props, false);

      expect(routed.drawer).toBe("traceDetails");
      expect(routed.props).toBe(props);
    });
  });
});
