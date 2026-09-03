/**
 * @vitest-environment jsdom
 *
 * The product sidebars opt into the compact menu density for their
 * subtree via SideMenuDensityProvider.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { House } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/tracking", () => ({ trackEvent: vi.fn() }));

import { SideMenuLink } from "../SideMenuLink";
import { SideMenuSectionLabel } from "../SideMenuSectionLabel";
import { SideMenuDensityProvider } from "../sideMenuDensity";

function renderMenu({ isCompact }: { isCompact: boolean }) {
  const menu = (
    <>
      <SideMenuLink icon={House} label="Home" href="/home" />
      <SideMenuSectionLabel label="Observe" />
    </>
  );
  return render(
    <ChakraProvider value={defaultSystem}>
      {isCompact ? (
        <SideMenuDensityProvider density="compact">
          {menu}
        </SideMenuDensityProvider>
      ) : (
        menu
      )}
    </ChakraProvider>,
  );
}

/** The item row carries the height, gap and padding; the label the type. */
function itemRow() {
  return screen.getByRole("link", { name: "Home" }).firstElementChild;
}

afterEach(() => {
  cleanup();
});

describe("sidebar menu density", () => {
  describe("when a sidebar asks for the compact density", () => {
    /** @scenario "The sidebar draws its menu one step smaller" */
    it("draws the item and its heading one step smaller", () => {
      renderMenu({ isCompact: true });

      expect(screen.getByText("Home")).toHaveStyle({ fontSize: "13px" });
      expect(itemRow()).toHaveStyle({
        height: "29px",
        gap: "var(--chakra-spacing-2\\.5)",
        paddingInline: "var(--chakra-spacing-2)",
      });
      expect(screen.getByText("Observe")).toHaveStyle({
        fontSize: "10px",
        fontWeight: "var(--chakra-font-weights-semibold)",
        // 0.09em of the 10px heading
        letterSpacing: "0.9px",
      });
    });
  });
});
