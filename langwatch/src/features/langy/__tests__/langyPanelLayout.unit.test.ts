import { describe, expect, it } from "vitest";
import {
  FLOATING_PANEL_MAX_WIDTH,
  resolveFloatingPanelWidth,
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
