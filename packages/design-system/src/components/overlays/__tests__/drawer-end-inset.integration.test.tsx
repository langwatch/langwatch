/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Drawer, DrawerOffsetProvider, setDrawerEndInset } from "../drawer.tsx";
import { Drawer as StudioDrawer } from "../studio-drawer.tsx";

function renderOpenDrawer(Parts: typeof Drawer) {
  renderWithDesignSystem(
    <DrawerOffsetProvider value={{ marginTop: 48 }}>
      <Parts.Root open>
        <Parts.Content portalled={false} data-testid="drawer">
          <Parts.Body>body</Parts.Body>
        </Parts.Content>
      </Parts.Root>
    </DrawerOffsetProvider>,
  );
  return screen.getByTestId("drawer");
}

describe.each([Drawer, StudioDrawer])(
  "given a docked side panel keeps room on the right edge",
  (Parts) => {
    afterEach(() => {
      setDrawerEndInset(0);
      cleanup();
    });

    it("every drawer yields that room", () => {
      setDrawerEndInset(412);
      expect(renderOpenDrawer(Parts)).toHaveStyle({ marginInlineEnd: "412px", marginTop: "48px" });
    });

    it("keeps the default edge when the panel is not docked", () => {
      expect(renderOpenDrawer(Parts).style.marginInlineEnd).toBe("");
    });
  },
);
