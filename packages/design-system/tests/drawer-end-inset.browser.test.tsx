/** Measured in real Chromium: a drawer yields the docked side panel's room on a wide screen. */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
  Drawer,
  DrawerOffsetProvider,
  setDrawerEndInset,
} from "../src/components/overlays/drawer.tsx";
import { Text } from "../src/primitives.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const DOCK_ROOM_PX = 412;

/** The drawer slides in; measure where it comes to rest. */
async function restingGapToRightEdge(element: Element): Promise<number> {
  await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  return window.innerWidth - element.getBoundingClientRect().right;
}

beforeEach(async () => {
  await page.viewport(1400, 800);
});

afterEach(() => {
  setDrawerEndInset(0);
  cleanup();
});

describe("given a docked side panel keeps room on the right edge of a wide screen", () => {
  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("the compound drawer sits clear of that room", async () => {
    setDrawerEndInset(DOCK_ROOM_PX);
    renderWithDesignSystem(
      <Drawer.Root open placement="end">
        <Drawer.Content data-testid="drawer">
          <Drawer.Body>
            <Text>body</Text>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>,
    );
    const drawer = await screen.findByTestId("drawer");

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(DOCK_ROOM_PX, 0);
  });

  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("the framed drawer sits clear of that room", async () => {
    setDrawerEndInset(DOCK_ROOM_PX);
    renderWithDesignSystem(
      <Drawer title="Trace" onClose={() => undefined} data-testid="framed">
        <Text>body</Text>
      </Drawer>,
    );
    const drawer = await screen.findByTestId("framed");

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(DOCK_ROOM_PX, 0);
  });

  it("a drawer below a header keeps its top offset", async () => {
    renderWithDesignSystem(
      <DrawerOffsetProvider value={{ marginTop: 48 }}>
        <Drawer.Root open placement="end">
          <Drawer.Content data-testid="drawer">
            <Drawer.Body>
              <Text>body</Text>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Root>
      </DrawerOffsetProvider>,
    );
    const drawer = await screen.findByTestId("drawer");
    await restingGapToRightEdge(drawer);

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
  });

  it("a phone keeps the header offset above the full-screen sheet", async () => {
    await page.viewport(600, 800);
    renderWithDesignSystem(
      <DrawerOffsetProvider value={{ marginTop: 48 }}>
        <Drawer.Root open placement="end">
          <Drawer.Content data-testid="drawer">
            <Drawer.Body>
              <Text>body</Text>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Root>
      </DrawerOffsetProvider>,
    );
    const drawer = await screen.findByTestId("drawer");
    await restingGapToRightEdge(drawer);

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
  });

  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("a phone still shows the drawer as a full-screen sheet", async () => {
    await page.viewport(600, 800);
    setDrawerEndInset(DOCK_ROOM_PX);
    renderWithDesignSystem(
      <Drawer.Root open placement="end">
        <Drawer.Content data-testid="drawer">
          <Drawer.Body>
            <Text>body</Text>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>,
    );
    const drawer = await screen.findByTestId("drawer");

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
  });
});
