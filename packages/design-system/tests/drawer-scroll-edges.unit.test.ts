import { describe, expect, it } from "vitest";

import {
  DRAWER_GLASS_DEFAULT,
  drawerEdges,
  NO_DRAWER_EDGES,
  sameDrawerEdges,
} from "../src/overlays/drawer-chrome.rules.ts";

const body = { scrollHeight: 1000, clientHeight: 400 };

describe("drawer scroll edges", () => {
  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it.each([
    { name: "at the top", scrollTop: 0, expected: { top: false, bottom: true } },
    { name: "within a pixel of the top", scrollTop: 1, expected: { top: false, bottom: true } },
    { name: "between the ends", scrollTop: 300, expected: { top: true, bottom: true } },
    {
      name: "within a pixel of the bottom",
      scrollTop: 599,
      expected: { top: true, bottom: false },
    },
    { name: "at the bottom", scrollTop: 600, expected: { top: true, bottom: false } },
  ])("$name", ({ scrollTop, expected }) => {
    expect(drawerEdges({ ...body, scrollTop })).toEqual(expected);
  });

  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("clamps an overscroll bounce to the ends", () => {
    expect(drawerEdges({ ...body, scrollTop: -80 })).toEqual({ top: false, bottom: true });
    expect(drawerEdges({ ...body, scrollTop: 700 })).toEqual({ top: true, bottom: false });
  });

  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("turns both edges off when the content fits, or overflows by a pixel or less", () => {
    expect(drawerEdges({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toEqual(
      NO_DRAWER_EDGES,
    );
    expect(drawerEdges({ scrollTop: 1, scrollHeight: 401, clientHeight: 400 })).toEqual(
      NO_DRAWER_EDGES,
    );
  });

  it("compares edges by their two booleans", () => {
    expect(sameDrawerEdges({ top: true, bottom: false }, { top: true, bottom: false })).toBe(true);
    expect(sameDrawerEdges({ top: true, bottom: false }, { top: false, bottom: false })).toBe(
      false,
    );
  });

  /** @scenario "The translucent header and footer are on by default, approved after the screenshots" */
  it("is on by default", () => {
    expect(DRAWER_GLASS_DEFAULT).toBe(true);
  });
});
