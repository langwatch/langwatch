import { LANGY_SHELL_DOCK_GUTTER_PX, langyShellDockInset } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import {
  APP_HEADER_HEIGHT,
  FLOATING_PANEL_INSET,
  FLOATING_PANEL_MAX_WIDTH,
  INSPECTOR_TUCK,
  LANGY_DOCK_GAP,
  resolveFloatingPanelWidth,
  resolveInspectorFrame,
  SIDEBAR_PANEL_WIDTH,
} from "../langy-panel-layout.ts";

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
        dockShellClaimed: false,
        panelHeightPx: 487,
        panelWidthPx: FLOATING_PANEL_MAX_WIDTH,
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
        dockShellClaimed: false,
        panelHeightPx: 487,
        panelWidthPx: FLOATING_PANEL_MAX_WIDTH,
      });

      expect(frame.right).toBe(
        `calc(${FLOATING_PANEL_MAX_WIDTH}px + ${FLOATING_PANEL_INSET * 2 - INSPECTOR_TUCK}px)`,
      );
    });

    it("falls back to the panel's resting silhouette before measurement", () => {
      const frame = resolveInspectorFrame({
        floating: true,
        dockShellClaimed: false,
        panelHeightPx: null,
        panelWidthPx: FLOATING_PANEL_MAX_WIDTH,
      });

      expect(frame.height).not.toBeNull();
      expect(frame.maxHeight).not.toBeNull();
    });
  });

  describe("given the docked sidebar", () => {
    it("spans exactly the dock's header-to-floor claim under an app shell", () => {
      const frame = resolveInspectorFrame({
        floating: false,
        dockShellClaimed: true,
        panelHeightPx: null,
        panelWidthPx: SIDEBAR_PANEL_WIDTH,
      });

      expect(frame.top).toBe(`${APP_HEADER_HEIGHT}px`);
      expect(frame.bottom).toBe("0px");
      expect(frame.height).toBeNull();
      expect(frame.right).toBe(`${SIDEBAR_PANEL_WIDTH - INSPECTOR_TUCK}px`);
    });

    it("runs the full viewport edge on a no-shell page, square like the pane", () => {
      const frame = resolveInspectorFrame({
        floating: false,
        dockShellClaimed: false,
        panelHeightPx: null,
        panelWidthPx: SIDEBAR_PANEL_WIDTH,
      });

      expect(frame.top).toBe("0px");
      expect(frame.borderTopLeftRadius).toBe("0px");
    });
  });
});

describe("the room a claiming app shell keeps for the dock", () => {
  it("is the docked panel's width plus the gap between the two cards", () => {
    expect(LANGY_SHELL_DOCK_GUTTER_PX).toBe(LANGY_DOCK_GAP);
    expect(langyShellDockInset(SIDEBAR_PANEL_WIDTH)).toBe(SIDEBAR_PANEL_WIDTH + LANGY_DOCK_GAP);
    expect(langyShellDockInset(480)).toBe(480 + LANGY_DOCK_GAP);
  });
});
