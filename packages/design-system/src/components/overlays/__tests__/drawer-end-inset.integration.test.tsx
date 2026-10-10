/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Drawer, setDrawerEndInset } from "../drawer.tsx";

function renderOpenDrawer() {
  renderWithDesignSystem(
    <Drawer.Root open>
      <Drawer.Content portalled={false} data-testid="drawer">
        <Drawer.Body>body</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
  );
  return screen.getByTestId("drawer");
}

describe("given a docked side panel keeps room on the right edge", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  it("every drawer yields that room", () => {
    setDrawerEndInset(412);
    expect(renderOpenDrawer()).toHaveStyle({ marginInlineEnd: "412px" });
  });

  it("keeps the default edge when the panel is not docked", () => {
    expect(renderOpenDrawer().style.marginInlineEnd).toBe("");
  });
});
