/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { setDrawerEndInset, useDrawerEndInset } from "@langwatch/design-system/drawer";
import { LANGY_DOCK_WIDTH_PX, langyShellDockInset } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { langyDockRoom } from "../langy-dock-room.tsx";

const WIDENED_PX = 570;
const state = vi.hoisted(() => ({
  isOpen: true,
  panelMode: "sidebar",
  dockShifted: true,
  dockWidthPx: 570,
  claimDockShell: () => {},
  releaseDockShell: () => {},
}));

vi.mock("../behavior/langy/langy.store.ts", () => ({
  useLangyStore: (select: (store: typeof state) => unknown) => select(state),
}));

function DrawerProbe() {
  return <span data-testid="drawer-inset">{useDrawerEndInset()}</span>;
}

describe("given the docked Langy panel was widened", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  /** @scenario "A drawer opening beside a widened dock keeps the default gap" */
  it("a drawer yields the default-width inset while the page keeps the live width", () => {
    let pageInset = -1;
    render(
      <>
        {langyDockRoom({
          render: (inset) => {
            pageInset = inset;
            return null;
          },
        })}
        <DrawerProbe />
      </>,
    );

    expect(pageInset).toBe(langyShellDockInset(WIDENED_PX));
    // The gap stays the default strip: the drawer's inset never grows with the widened dock.
    const drawerInset = Number(screen.getByTestId("drawer-inset").textContent);
    expect(drawerInset).toBe(langyShellDockInset(LANGY_DOCK_WIDTH_PX) + 8);
    expect(drawerInset).not.toBe(langyShellDockInset(WIDENED_PX) + 8);
  });
});
