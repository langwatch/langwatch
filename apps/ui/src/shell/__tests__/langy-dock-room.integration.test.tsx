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

/**
 * Spec: specs/langy/langy-panel-layout.feature
 * "A drawer opening beside a widened dock sits flush against it"
 */
describe("given the docked Langy panel was widened", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

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
    expect(screen.getByTestId("drawer-inset")).toHaveTextContent(
      String(langyShellDockInset(LANGY_DOCK_WIDTH_PX) + 8),
    );
  });
});
