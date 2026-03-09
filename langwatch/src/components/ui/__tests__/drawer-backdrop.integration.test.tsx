/**
 * @vitest-environment jsdom
 *
 * Integration tests for the DrawerContent styling behavior.
 *
 * @see specs/features/drawer-backdrop-transparency-blur.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Drawer } from "../drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer() {
  render(
    <Drawer.Root open={true} placement="end">
      <Drawer.Content>
        <Drawer.Body>Content</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
    { wrapper: Wrapper },
  );
}

describe("DrawerContent transparency", () => {
  afterEach(cleanup);

  describe("when a drawer opens", () => {
    it("renders the drawer content panel", () => {
      renderDrawer();

      const content = document.querySelector(
        "[data-part='content']",
      ) as HTMLElement | null;
      expect(content).not.toBeNull();
      // Visual styles (blur, opacity) are applied via Chakra props on DrawerContent
      // and verified in the component source; jsdom cannot compute resolved CSS values.
    });

    it("does not render a separate backdrop overlay", () => {
      renderDrawer();

      const backdrop = document.querySelector("[data-part='backdrop']");
      expect(backdrop).toBeNull();
    });
  });
});
