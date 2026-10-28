/** Measured in real Chromium: a drawer yields the docked side panel's room on a wide screen. */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
  Drawer,
  DrawerOffsetProvider,
  setDrawerEndInset,
} from "../src/components/overlays/drawer.tsx";
import type { DrawerContentProps } from "../src/components/overlays/views/drawer-view.tsx";
import { Text } from "../src/primitives.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const DOCK_ROOM_PX = 412;
const PHONE_WIDTH = 600;

/** The drawer slides in; measure where it comes to rest. */
async function restingGapToRightEdge(element: Element): Promise<number> {
  await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  return window.innerWidth - element.getBoundingClientRect().right;
}

interface OpenDrawerOptions {
  width?: number;
  endInset?: number;
  headerOffset?: number;
  contentProps?: Partial<DrawerContentProps>;
}

/** Opens a compound drawer at a viewport width and returns it once it has come to rest. */
async function renderOpenDrawer({
  width = 1400,
  endInset = 0,
  headerOffset,
  contentProps,
}: OpenDrawerOptions = {}): Promise<HTMLElement> {
  await page.viewport(width, 800);
  setDrawerEndInset(endInset);
  const drawer = (
    <Drawer.Root open placement="end">
      <Drawer.Content data-testid="drawer" {...contentProps}>
        <Drawer.Body>
          <Text>body</Text>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
  renderWithDesignSystem(
    headerOffset == null ? (
      drawer
    ) : (
      <DrawerOffsetProvider value={{ marginTop: headerOffset }}>{drawer}</DrawerOffsetProvider>
    ),
  );
  const element = await screen.findByTestId("drawer");
  await restingGapToRightEdge(element);
  return element;
}

function bottomGap(element: Element): number {
  return window.innerHeight - element.getBoundingClientRect().bottom;
}

afterEach(() => {
  setDrawerEndInset(0);
  cleanup();
});

describe("given a docked side panel keeps room on the right edge of a wide screen", () => {
  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("the compound drawer sits clear of that room", async () => {
    const drawer = await renderOpenDrawer({ endInset: DOCK_ROOM_PX });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(DOCK_ROOM_PX, 0);
  });

  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("the framed drawer sits clear of that room", async () => {
    await page.viewport(1400, 800);
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
    const drawer = await renderOpenDrawer({ headerOffset: 48 });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
  });

  it("a phone keeps the header offset above the full-screen sheet", async () => {
    const drawer = await renderOpenDrawer({ width: PHONE_WIDTH, headerOffset: 48 });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
  });

  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("a phone still shows the drawer as a full-screen sheet", async () => {
    const drawer = await renderOpenDrawer({ width: PHONE_WIDTH, endInset: DOCK_ROOM_PX });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
  });

  it.each([
    ["no end margin", undefined],
    ["an end margin", "8px"],
  ])("a phone reaches both edges when the caller passes %s", async (_name, marginEnd) => {
    const drawer = await renderOpenDrawer({
      width: PHONE_WIDTH,
      contentProps: { marginEnd },
    });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
  });

  it("a phone ignores start and bottom margins a caller passes", async () => {
    const drawer = await renderOpenDrawer({
      width: PHONE_WIDTH,
      contentProps: { marginStart: "8px", marginBottom: "8px" },
    });

    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(bottomGap(drawer)).toBeCloseTo(0, 0);
  });

  it("a wide screen honours the end margin a caller passes", async () => {
    const drawer = await renderOpenDrawer({ contentProps: { marginEnd: "40px" } });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(40, 0);
  });
});
