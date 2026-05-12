/**
 * @vitest-environment jsdom
 *
 * Integration tests for depth-aware overlay z-index stacking.
 *
 * Verifies that nested overlays (e.g., Menu inside Popover inside Dialog)
 * each get a progressively higher z-index so inner overlays render above outer ones.
 *
 * @see https://github.com/langwatch/langwatch/issues/2519
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "../dialog";
import { Menu } from "../menu";
import { Popover } from "../popover";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Overlay z-index stacking", () => {
  afterEach(cleanup);

  describe("when a single overlay renders", () => {
    it("assigns z-index 2010 (base + 1 depth level)", () => {
      render(
        <Popover.Root open={true}>
          <Popover.Trigger>
            <button>Open</button>
          </Popover.Trigger>
          <Popover.Content>Popover content</Popover.Content>
        </Popover.Root>,
        { wrapper: Wrapper }
      );

      const positioner = document.querySelector<HTMLElement>(
        "[data-part='positioner']"
      );
      expect(positioner).not.toBeNull();
      expect(positioner!.style.zIndex).toBe("2010");
    });
  });

  describe("when a Menu opens inside a Popover inside a Dialog", () => {
    it("assigns incrementing z-indexes so the inner overlay is above the outer", () => {
      render(
        <Dialog.Root open={true}>
          <Dialog.Content>
            <Dialog.Body>
              <Popover.Root open={true}>
                <Popover.Trigger>
                  <button>Open popover</button>
                </Popover.Trigger>
                <Popover.Content>
                  <Menu.Root open={true}>
                    <Menu.Trigger>
                      <button>Open menu</button>
                    </Menu.Trigger>
                    <Menu.Content>
                      <Menu.Item value="a">Item A</Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                </Popover.Content>
              </Popover.Root>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>,
        { wrapper: Wrapper }
      );

      // Collect all positioner z-indexes set by our ref callbacks
      const positioners = document.querySelectorAll<HTMLElement>(
        "[data-part='positioner']"
      );
      const overlayZIndexes = Array.from(positioners)
        .map((el) => el.style.zIndex)
        .filter((z) => z !== "" && Number(z) >= 2000);

      // Popover (depth 1 → 2010) and Menu (depth 2 → 2020)
      expect(overlayZIndexes.length).toBeGreaterThanOrEqual(2);

      const sorted = overlayZIndexes.map(Number).sort((a, b) => a - b);
      // Inner overlay (Menu) has a higher z-index than outer (Popover)
      expect(sorted[0]).toBe(2010); // Popover at depth 1
      expect(sorted[1]).toBe(2020); // Menu at depth 2
    });
  });
});
