/** Measured in real Chromium: a drawer floats on a wide screen and fills a phone as a sheet. */
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
/** The floating drawer's own margin on a wide screen (spacing token 2). */
const FLOAT_PX = 8;
/** The studio header's clearance (`marginTop="14"`). */
const STUDIO_HEADER_PX = 56;

/** The drawer slides in; measure where it comes to rest. */
async function restingGapToRightEdge(element: Element): Promise<number> {
  await Promise.all(element.getAnimations({ subtree: true }).map((motion) => motion.finished));
  return window.innerWidth - element.getBoundingClientRect().right;
}

function bottomGap(element: Element): number {
  return window.innerHeight - element.getBoundingClientRect().bottom;
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

interface FramedDrawerOptions {
  width?: number;
  endInset?: number;
  topInset?: "studio-header";
}

/** Opens the framed drawer feature code uses and returns it once it has come to rest. */
async function renderFramedDrawer({
  width = 1400,
  endInset = 0,
  topInset,
}: FramedDrawerOptions = {}): Promise<HTMLElement> {
  await page.viewport(width, 800);
  setDrawerEndInset(endInset);
  renderWithDesignSystem(
    <Drawer title="Trace" onClose={() => undefined} topInset={topInset} data-testid="framed">
      <Text>body</Text>
    </Drawer>,
  );
  const element = await screen.findByTestId("framed");
  await restingGapToRightEdge(element);
  return element;
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
    const drawer = await renderFramedDrawer({ endInset: DOCK_ROOM_PX });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(DOCK_ROOM_PX, 0);
  });
});

describe("given a wide screen with no docked side panel", () => {
  it("a drawer floats with its own small margin on every side", async () => {
    const drawer = await renderOpenDrawer();

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(FLOAT_PX, 0);
    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(FLOAT_PX, 0);
    expect(bottomGap(drawer)).toBeCloseTo(FLOAT_PX, 0);
  });

  it("a drawer below a header keeps its top offset", async () => {
    const drawer = await renderOpenDrawer({ headerOffset: 48 });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
  });

  it("a studio drawer keeps its clearance below the studio header", async () => {
    const drawer = await renderFramedDrawer({ topInset: "studio-header" });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(STUDIO_HEADER_PX, 0);
  });

  it("a caller's top margin beats a header offset", async () => {
    const drawer = await renderOpenDrawer({
      headerOffset: 48,
      contentProps: { marginTop: "100px" },
    });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(100, 0);
  });

  it("the drawer honours the end margin a caller passes", async () => {
    const drawer = await renderOpenDrawer({ contentProps: { marginEnd: "40px" } });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(40, 0);
  });
});

describe("given a phone", () => {
  /** @scenario "An open drawer sits beside the open Langy panel instead of under it" */
  it("a docked side panel's room still leaves the drawer a full-screen sheet", async () => {
    const drawer = await renderOpenDrawer({ width: PHONE_WIDTH, endInset: DOCK_ROOM_PX });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(0, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
    expect(bottomGap(drawer)).toBeCloseTo(0, 0);
  });

  it.each([
    ["no end margin", undefined],
    ["an end margin", "8px"],
  ])("the sheet reaches both edges when the caller passes %s", async (_name, marginEnd) => {
    const drawer = await renderOpenDrawer({
      width: PHONE_WIDTH,
      contentProps: { marginEnd },
    });

    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
  });

  it("the sheet ignores start and bottom margins a caller passes", async () => {
    const drawer = await renderOpenDrawer({
      width: PHONE_WIDTH,
      contentProps: { marginStart: "8px", marginBottom: "8px" },
    });

    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(bottomGap(drawer)).toBeCloseTo(0, 0);
  });

  it("the sheet sits below a header offset and fills the rest", async () => {
    const drawer = await renderOpenDrawer({ width: PHONE_WIDTH, headerOffset: 48 });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(48, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
    expect(bottomGap(drawer)).toBeCloseTo(0, 0);
  });

  it("a studio sheet sits below the studio header and fills the width", async () => {
    const drawer = await renderFramedDrawer({ width: PHONE_WIDTH, topInset: "studio-header" });

    expect(drawer.getBoundingClientRect().top).toBeCloseTo(STUDIO_HEADER_PX, 0);
    expect(drawer.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(await restingGapToRightEdge(drawer)).toBeCloseTo(0, 0);
  });
});
