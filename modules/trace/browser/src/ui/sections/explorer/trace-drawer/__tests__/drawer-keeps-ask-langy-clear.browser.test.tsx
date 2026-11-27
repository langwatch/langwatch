/**
 * A wide trace drawer beside the search bar's Ask Langy button, measured in real Chromium:
 * the button stays uncovered, and docking Langy narrows the drawer rather than shifting it.
 */

import { defineSlice } from "@langwatch/browser-host/global-store";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { useFittedDrawerWidth } from "../../../../../behavior/explorer/trace-drawer/use-fitted-drawer-width.ts";
import { DRAWER_KEEP_CLEAR_ATTRIBUTE } from "../../../../../model/explorer/trace-drawer/drawer-fit.ts";
import { Drawer } from "../../../drawer.tsx";

// Stand in for Langy, the owner of the slice, which this package only reads.
const langy = defineSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  create: () => ({ ...LANGY_ABSENT_SURFACE }),
});

function WideTraceDrawer() {
  const { widthPx: width } = useFittedDrawerWidth({ preferredPx: 1200 });
  return (
    <>
      <button
        type="button"
        style={{ position: "fixed", top: 80, left: 225, width: 98 }}
        {...{ [DRAWER_KEEP_CLEAR_ATTRIBUTE]: "" }}
      >
        Ask Langy
      </button>
      <Drawer.Root open placement="end" modal={false}>
        <Drawer.Content data-testid="trace-drawer" style={{ width, maxWidth: width }}>
          <Drawer.Body>trace</Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}

async function resting(element: Element): Promise<DOMRect> {
  await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  return element.getBoundingClientRect();
}

function buttonIsOnTop(): boolean {
  const button = screen.getByRole("button", { name: "Ask Langy" }).getBoundingClientRect();
  const hit = document.elementFromPoint(button.left + button.width / 2, button.top + 4);
  return hit?.textContent === "Ask Langy";
}

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  cleanup();
  langy.setState({ isOpen: false, panelMode: "sidebar" });
});

describe("given a trace drawer the reader dragged wider than the space beside Ask Langy", () => {
  /** @scenario "A wide trace drawer leaves the Ask Langy button visible" */
  it("keeps the drawer's left edge a gap right of the button, which stays clickable", async () => {
    renderWithDesignSystem(<WideTraceDrawer />);
    const drawer = await resting(await screen.findByTestId("trace-drawer"));

    expect(drawer.left).toBeGreaterThanOrEqual(323 + 12 - 1);
    expect(buttonIsOnTop()).toBe(true);
  });

  describe("when the window gets narrower", () => {
    /** @scenario "Narrowing the window keeps the drawer clear of Ask Langy" */
    it("narrows the drawer so the button stays uncovered", async () => {
      renderWithDesignSystem(<WideTraceDrawer />);
      await resting(await screen.findByTestId("trace-drawer"));

      await page.viewport(1100, 800);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const after = await resting(screen.getByTestId("trace-drawer"));

      expect(after.left).toBeGreaterThanOrEqual(323 + 12 - 1);
      expect(buttonIsOnTop()).toBe(true);
    });
  });

  describe("when Langy opens docked beside it", () => {
    /** @scenario "Opening Langy beside a wide trace drawer narrows the drawer" */
    it("narrows the drawer, which still leaves the button uncovered", async () => {
      renderWithDesignSystem(<WideTraceDrawer />);
      const element = await screen.findByTestId("trace-drawer");
      const before = await resting(element);

      act(() => langy.setState({ isOpen: true, panelMode: "sidebar" }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await resting(element);

      expect(after.width).toBeLessThan(before.width - 300);
      expect(after.left).toBeGreaterThanOrEqual(323 + 12 - 1);
      expect(window.innerWidth - after.right).toBeCloseTo(8 + 392 + 12, 0);
      expect(buttonIsOnTop()).toBe(true);
    });
  });
});
