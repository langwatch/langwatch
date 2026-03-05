/**
 * @vitest-environment jsdom
 *
 * Integration tests for the DrawerContent backdrop behavior.
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

function renderDrawer({ backdrop }: { backdrop?: boolean } = {}) {
  render(
    <Drawer.Root open={true} placement="end">
      <Drawer.Content backdrop={backdrop}>
        <Drawer.Body>Content</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
    { wrapper: Wrapper },
  );
}

describe("DrawerContent backdrop", () => {
  afterEach(cleanup);

  describe("when a drawer opens", () => {
    it("renders a backdrop overlay element", () => {
      renderDrawer();

      const backdrop = document.querySelector(
        "[data-part='backdrop']",
      ) as HTMLElement | null;
      expect(backdrop).not.toBeNull();
      // Visual styles (blur, opacity) are applied via Chakra props and verified
      // in the component source; jsdom cannot compute resolved CSS values.
    });
  });

  describe("when a drawer opens with backdrop disabled", () => {
    it("renders no backdrop overlay", () => {
      renderDrawer({ backdrop: false });

      const backdrop = document.querySelector("[data-part='backdrop']");
      expect(backdrop).toBeNull();
    });
  });
});
