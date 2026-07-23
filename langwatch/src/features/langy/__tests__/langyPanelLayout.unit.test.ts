import { describe, expect, it } from "vitest";
import {
  FLOATING_PANEL_CSS_WIDTH,
  FLOATING_PANEL_INSET,
  FLOATING_PANEL_MAX_WIDTH,
  INSPECTOR_TUCK,
  resolveFloatingPanelWidth,
  resolveInspectorFrame,
  SIDEBAR_PANEL_WIDTH,
} from "../logic/langyPanelLayout";

describe("resolveFloatingPanelWidth", () => {
  it("keeps the normal desktop width", () => {
    expect(resolveFloatingPanelWidth(1_440)).toBe(FLOATING_PANEL_MAX_WIDTH);
  });

  it("gives the page room in a narrow split window", () => {
    expect(resolveFloatingPanelWidth(514)).toBeCloseTo(380.36);
  });

  it("never overflows a phone-sized viewport", () => {
    expect(resolveFloatingPanelWidth(320)).toBe(296);
  });

  it("uses the desktop width until the viewport has been measured", () => {
    expect(resolveFloatingPanelWidth(0)).toBe(FLOATING_PANEL_MAX_WIDTH);
  });
});

describe("resolveInspectorFrame", () => {
  describe("given the floating card", () => {
    it("mirrors the panel's measured height on the panel's own inset", () => {
      const frame = resolveInspectorFrame({
        floating: true,
        panelHeightPx: 487,
      });

      expect(frame.height).toBe("487px");
      expect(frame.bottom).toBe(`${FLOATING_PANEL_INSET}px`);
      // Bottom-anchored with an explicit height: sharing bottom AND height is
      // what makes the two top edges land on the same line.
      expect(frame.top).toBeNull();
    });

    it("tucks its right edge under the panel's left edge", () => {
      const frame = resolveInspectorFrame({
        floating: true,
        panelHeightPx: 487,
      });

      expect(frame.right).toBe(
        `calc(${FLOATING_PANEL_CSS_WIDTH} + ${FLOATING_PANEL_INSET * 2 - INSPECTOR_TUCK}px)`,
      );
    });

    it("falls back to the panel's resting silhouette before measurement", () => {
      const frame = resolveInspectorFrame({
        floating: true,
        panelHeightPx: null,
      });

      expect(frame.height).not.toBeNull();
      expect(frame.maxHeight).not.toBeNull();
    });
  });

  describe("given the docked sidebar", () => {
    it("runs the full viewport edge, square like the flush pane", () => {
      const frame = resolveInspectorFrame({
        floating: false,
        panelHeightPx: null,
      });

      expect(frame.top).toBe("0px");
      expect(frame.bottom).toBe("0px");
      expect(frame.height).toBeNull();
      expect(frame.right).toBe(`${SIDEBAR_PANEL_WIDTH - INSPECTOR_TUCK}px`);
      expect(frame.borderTopLeftRadius).toBe("0px");
    });
  });
});
