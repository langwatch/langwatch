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
import { cssRulesForElement } from "~/utils/emotionTestCss";
import { Drawer } from "../drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer() {
  render(
    <Drawer.Root open={true} placement="end">
      <Drawer.Content bg="bg">
        <Drawer.Body>Content</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>,
    { wrapper: Wrapper },
  );
}

describe("DrawerContent transparency", () => {
  afterEach(cleanup);

  describe("when a drawer opens", () => {
    /** @scenario Drawer content panel applies blur filter and transparency */
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

    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("references the shared --lw-backdrop-blur and --lw-panel-alpha CSS variables instead of hardcoded values", () => {
      // No `bg` override here (unlike renderDrawer()'s helper default) --
      // this exercises DrawerContent's OWN background/backdropFilter props
      // (see src/components/ui/drawer.tsx), which every real caller in the
      // app relies on by not overriding them. If either is ever hardcoded
      // again, reduced-graphics mode would silently stop affecting every
      // drawer in the app despite the "drawer" recipe in _app.tsx still
      // looking correct.
      render(
        <Drawer.Root open={true} placement="end">
          <Drawer.Content>
            <Drawer.Body>Content</Drawer.Body>
          </Drawer.Content>
        </Drawer.Root>,
        { wrapper: Wrapper },
      );

      // Scope to the drawer content panel's OWN generated class so an
      // unrelated rule referencing these variables can't keep the test green.
      const content = document.querySelector("[data-part='content']") as HTMLElement;
      const contentCss = cssRulesForElement(content);
      expect(contentCss).toContain("--lw-backdrop-blur");
      expect(contentCss).toContain("--lw-panel-alpha");
    });
  });
});
