import { describe, expect, it } from "vitest";

import { resolveFloatingPanelWidth } from "../langy-panel-layout.ts";
import {
  clampPanelWidth,
  parseStoredPanelWidths,
  resolvePanelWidth,
  resolvePanelWidthBounds,
} from "../langy-panel-resize.ts";

describe("resolvePanelWidthBounds", () => {
  /** @scenario "The width stays within a usable range" */
  it("bounds the floating card by its minimum and the width the window can show", () => {
    expect(resolvePanelWidthBounds({ placement: "floating", viewportWidth: 1_440 })).toEqual({
      min: 340,
      max: 1_416,
      default: 432,
    });
  });

  /** @scenario "The width stays within a usable range" */
  it("bounds the sidebar so the page keeps its room, defaulting to the dock width", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 1_000 })).toEqual({
      min: 320,
      max: 520,
      default: 392,
    });
  });

  /** @scenario "The docked panel leaves the page room" */
  it("keeps 480px for the page beside the dock", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 1_440 })).toMatchObject({
      min: 320,
      max: 960,
    });
  });

  /** @scenario "The docked panel leaves the page room" */
  it("keeps 480px for the page beside a drawer the floating card dodges", () => {
    expect(
      resolvePanelWidthBounds({ placement: "floating", viewportWidth: 1_440, besideDrawer: true }),
    ).toMatchObject({ min: 340, max: 948 });
  });

  /** @scenario "The width stays within a usable range" */
  it("lets a floating card with no drawer reach the window's edge gutter", () => {
    expect(resolvePanelWidthBounds({ placement: "floating", viewportWidth: 1_440 }).max).toBe(
      1_416,
    );
  });

  /** @scenario "The width stays within a usable range" */
  it("never lets the maximum fall below the minimum on a narrow window", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 700 })).toMatchObject({
      min: 320,
      max: 320,
    });
  });

  /** @scenario "The width stays within a usable range" */
  it("never exceeds a phone-sized viewport", () => {
    const bounds = resolvePanelWidthBounds({ placement: "floating", viewportWidth: 320 });
    expect(bounds).toEqual({ min: 296, max: 296, default: 296 });
  });

  /** @scenario "The width stays within a usable range" */
  it("caps at the default until the viewport has been measured", () => {
    expect(resolvePanelWidthBounds({ placement: "sidebar", viewportWidth: 0 })).toMatchObject({
      max: 392,
      default: 392,
    });
  });
});

describe("the floating default on narrow viewports", () => {
  /** @scenario "The width stays within a usable range" */
  it.each([500, 600, 700])(
    "is the card's own default and within bounds at %ipx",
    (viewportWidth) => {
      const width = resolvePanelWidth({ placement: "floating", viewportWidth, stored: undefined });
      const { min, max } = resolvePanelWidthBounds({ placement: "floating", viewportWidth });
      expect(width).toBe(Math.round(resolveFloatingPanelWidth(viewportWidth)));
      expect(width).toBeGreaterThanOrEqual(min);
      expect(width).toBeLessThanOrEqual(max);
    },
  );
});

describe("clampPanelWidth", () => {
  /** @scenario "The width stays within a usable range" */
  it("stops at the minimum and the maximum", () => {
    const base = { placement: "floating", viewportWidth: 1_440 } as const;
    expect(clampPanelWidth({ ...base, width: 100 })).toBe(340);
    expect(clampPanelWidth({ ...base, width: 5_000 })).toBe(1_416);
    expect(clampPanelWidth({ ...base, width: 500.4 })).toBe(500);
  });

  /** @scenario "The docked panel leaves the page room" */
  it("stops the dock where the page would keep less than 480px", () => {
    expect(clampPanelWidth({ placement: "sidebar", viewportWidth: 1_440, width: 5_000 })).toBe(960);
    expect(
      clampPanelWidth({
        placement: "floating",
        viewportWidth: 1_440,
        width: 5_000,
        besideDrawer: true,
      }),
    ).toBe(948);
  });
});

describe("resolvePanelWidth", () => {
  it("falls back to the default without a stored choice", () => {
    expect(
      resolvePanelWidth({ placement: "sidebar", viewportWidth: 1_440, stored: undefined }),
    ).toBe(392);
  });

  /** @scenario "A window resize re-clamps the chosen width" */
  it("re-clamps a stored width to a narrower window without losing the choice", () => {
    const stored = 700;
    expect(resolvePanelWidth({ placement: "floating", viewportWidth: 1_440, stored })).toBe(700);
    expect(resolvePanelWidth({ placement: "floating", viewportWidth: 600, stored })).toBe(576);
    expect(stored).toBe(700);
  });
});

describe("parseStoredPanelWidths", () => {
  /** @scenario "Each layout remembers its own width across reloads" */
  it("keeps usable widths per layout", () => {
    expect(parseStoredPanelWidths({ floating: 500, sidebar: 420 })).toEqual({
      floating: 500,
      sidebar: 420,
    });
  });

  /** @scenario "Each layout remembers its own width across reloads" */
  it.each([null, undefined, "wide", 12, [], { floating: "500", sidebar: -1 }, { floating: NaN }])(
    "ignores unusable storage %j",
    (raw) => {
      expect(parseStoredPanelWidths(raw)).toEqual({});
    },
  );
});
