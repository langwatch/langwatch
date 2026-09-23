// @vitest-environment jsdom
/**
 * The order the bridge attaches in: its load listener is on the frame before
 * the frame is navigated, so a document that loads at once cannot miss lw:init.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrameBridge } from "../frame-bridge.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("given a chart frame the bridge attaches to", () => {
  describe("when the bridge is created", () => {
    /** @scenario "The bridge listens for the frame before navigating it" */
    it("installs the load listener before it navigates the frame", () => {
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      const navigatedWhenListening: (string | null)[] = [];
      const addEventListener = iframe.addEventListener.bind(iframe);
      vi.spyOn(iframe, "addEventListener").mockImplementation((type, listener, options) => {
        if (type === "load") navigatedWhenListening.push(iframe.getAttribute("src"));
        addEventListener(type, listener, options);
      });

      const bridge = createFrameBridge({
        iframe,
        source: "export default () => null;",
        executeQuery: vi.fn(),
        dashboardContext: {
          timeWindow: { start: 0, end: 1 },
          granularitySeconds: 60,
          theme: "light",
        },
        onLog: vi.fn(),
        onHeightChange: vi.fn(),
        onTeardown: vi.fn(),
      });

      // Listening began while the frame had no address yet, and the bridge then navigated it.
      expect(navigatedWhenListening).toEqual([null]);
      expect(iframe.getAttribute("src")).not.toBeNull();
      bridge.dispose();
    });
  });
});
