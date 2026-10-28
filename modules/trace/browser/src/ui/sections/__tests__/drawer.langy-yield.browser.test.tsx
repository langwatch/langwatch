/**
 * The trace drawer beside an open Langy panel on a wide screen, measured in real
 * Chromium: jsdom drops the media-conditioned margin that once covered the yield.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { Drawer } from "../drawer.tsx";

const langy = vi.hoisted(() => ({
  state: { isOpen: false, panelMode: "sidebar" as "sidebar" | "floating" },
}));

vi.mock("../../../behavior/langy/langy.store.ts", () => ({
  useLangyStore: <T,>(select: (state: typeof langy.state) => T) => select(langy.state),
}));

/** The docked panel's width plus the drawer's own 8px margin and the 12px gap between cards. */
const DOCKED_YIELD_PX = 8 + 392 + 12;

async function restingGapToRightEdge(element: Element): Promise<number> {
  await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  return window.innerWidth - element.getBoundingClientRect().right;
}

async function renderTraceDrawer(): Promise<HTMLElement> {
  renderWithDesignSystem(
    <Drawer.Root open placement="end">
      <Drawer.Content data-testid="trace-drawer">
        <Drawer.Body>trace</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
  );
  return screen.findByTestId("trace-drawer");
}

beforeEach(async () => {
  await page.viewport(1400, 800);
});

afterEach(() => {
  cleanup();
  langy.state = { isOpen: false, panelMode: "sidebar" };
});

describe("given the Langy panel is open and docked on a wide screen", () => {
  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("the trace drawer sits to the left of the panel, not under it", async () => {
    langy.state = { isOpen: true, panelMode: "sidebar" };

    const drawer = await renderTraceDrawer();

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(DOCKED_YIELD_PX, 0);
  });
});

describe("given the Langy panel is minimised", () => {
  it("the trace drawer keeps the right edge", async () => {
    const drawer = await renderTraceDrawer();

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(8, 0);
  });
});
