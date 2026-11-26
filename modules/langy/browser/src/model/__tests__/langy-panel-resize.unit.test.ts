import { describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  PANEL_RESIZE_LARGE_STEP_PX,
  PANEL_RESIZE_STEP_PX,
  parseStoredPanelWidths,
  resolvePanelWidth,
  resolvePanelWidthBounds,
  stepPanelWidth,
} from "../langy-panel-resize.ts";

/** @scenario The width stays within a usable range */
describe("resolvePanelWidthBounds", () => {
  it("bounds the floating card by its minimum and a share of a desktop viewport", () => {
    expect(resolvePanelWidthBounds({ placement: "floating", viewportWidth: 1_440 })).toEqual({
      min: 340,
      max: 760,
      default: 432,
    });
  });

  it("bounds the sidebar to half a laptop viewport, defaulting to the dock width", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 1_000 })).toEqual({
      min: 320,
      max: 500,
      default: 392,
    });
  });

  it("never exceeds a phone-sized viewport", () => {
    const bounds = resolvePanelWidthBounds({ placement: "floating", viewportWidth: 320 });
    expect(bounds).toEqual({ min: 296, max: 296, default: 296 });
  });

  it("uses the absolute caps until the viewport has been measured", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 0 })).toMatchObject({
      max: 640,
      default: 392,
    });
  });
});

describe("clampPanelWidth", () => {
  it("stops at the minimum and the maximum", () => {
    const base = { placement: "floating", viewportWidth: 1_440 } as const;
    expect(clampPanelWidth({ ...base, width: 100 })).toBe(340);
    expect(clampPanelWidth({ ...base, width: 5_000 })).toBe(760);
    expect(clampPanelWidth({ ...base, width: 500.4 })).toBe(500);
  });
});

/** @scenario A window resize re-clamps the chosen width */
describe("resolvePanelWidth", () => {
  it("falls back to the default without a stored choice", () => {
    expect(
      resolvePanelWidth({ placement: "sidebar", viewportWidth: 1_440, stored: undefined }),
    ).toBe(392);
  });

  it("re-clamps a stored width to a narrower window without losing the choice", () => {
    const stored = 700;
    expect(resolvePanelWidth({ placement: "floating", viewportWidth: 1_440, stored })).toBe(700);
    expect(resolvePanelWidth({ placement: "floating", viewportWidth: 800, stored })).toBe(480);
    expect(stored).toBe(700);
  });
});

describe("stepPanelWidth", () => {
  const base = { placement: "sidebar", viewportWidth: 1_440, current: 400 } as const;

  it("moves one step, or a large step", () => {
    expect(stepPanelWidth({ ...base, direction: "wider", large: false })).toBe(
      400 + PANEL_RESIZE_STEP_PX,
    );
    expect(stepPanelWidth({ ...base, direction: "narrower", large: true })).toBe(
      400 - PANEL_RESIZE_LARGE_STEP_PX,
    );
  });

  it("stays inside the bounds", () => {
    expect(stepPanelWidth({ ...base, current: 640, direction: "wider", large: true })).toBe(640);
    expect(stepPanelWidth({ ...base, current: 320, direction: "narrower", large: false })).toBe(
      320,
    );
  });
});

/** @scenario Each layout remembers its own width across reloads */
describe("parseStoredPanelWidths", () => {
  it("keeps usable widths per layout", () => {
    expect(parseStoredPanelWidths({ floating: 500, sidebar: 420 })).toEqual({
      floating: 500,
      sidebar: 420,
    });
  });

  it.each([null, undefined, "wide", 12, [], { floating: "500", sidebar: -1 }, { floating: NaN }])(
    "ignores unusable storage %j",
    (raw) => {
      expect(parseStoredPanelWidths(raw)).toEqual({});
    },
  );
});
