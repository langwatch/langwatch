/**
 * Integration tests for the Dialog backdrop styling.
 * @vitest-environment jsdom
 * @see specs/features/dialog-backdrop-transparency-blur.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssRulesForElement } from "./emotion-test-css";
import { Dialog } from "../dialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderOpenDialog(extra?: Parameters<typeof Dialog.Content>[0]) {
  render(
    <Dialog.Root open={true}>
      <Dialog.Content bg="bg" {...extra}>
        <Dialog.Body>content</Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>,
    { wrapper: Wrapper },
  );
}

function getBackdrop(): HTMLElement {
  const backdrop = document.querySelector<HTMLElement>("[data-part='backdrop']");
  if (!backdrop) throw new Error("backdrop not found");
  return backdrop;
}

describe("Dialog backdrop", () => {
  afterEach(cleanup);

  describe("when a dialog opens", () => {
    /** @scenario Dialog backdrop renders with blur and no dark fill */
    it("renders a backdrop with the wrapper's transparency marker", () => {
      renderOpenDialog();
      const backdrop = getBackdrop();

      // The wrapper marks the backdrop with this data-attribute exactly when the
      // `bg="transparent"` hard-override is in place (see
      // src/components/ui/dialog.tsx).
      expect(backdrop.getAttribute("data-lw-transparent-backdrop")).toBe("true");
    });
  });

  describe("when a caller tries to set a dark background via backdropProps", () => {
    /** @scenario Caller cannot override the backdrop with a dark fill */
    it("strips bg/background/backgroundColor and warns in dev", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderOpenDialog({
        // Cast to widen the type so we exercise the runtime guard, since
        // the type-level Omit already forbids these keys at compile time.
        backdropProps: { bg: "blackAlpha.700" } as unknown as Parameters<
          typeof Dialog.Content
        >[0]["backdropProps"],
      });
      const backdrop = getBackdrop();
      const inlineBg = backdrop.style.background || backdrop.style.backgroundColor;
      expect(inlineBg).not.toMatch(/blackalpha|rgba\(0,\s*0,\s*0,/i);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("backdropProps.bg/background/backgroundColor is ignored"),
      );
      warn.mockRestore();
    });
  });

  describe("when a caller tries to set a dark background via inline style", () => {
    it("forces style.background and style.backgroundColor to transparent and warns", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderOpenDialog({
        backdropProps: {
          style: { backgroundColor: "black" },
        } as unknown as Parameters<typeof Dialog.Content>[0]["backdropProps"],
      });
      const backdrop = getBackdrop();
      expect(backdrop.style.backgroundColor).toBe("transparent");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("backdropProps.bg/background/backgroundColor is ignored"),
      );
      warn.mockRestore();
    });
  });

  describe("when rendering the backdrop's blur", () => {
    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("references the shared --lw-backdrop-blur CSS variable instead of a hardcoded value", () => {
      renderOpenDialog();

      // This backdrop covers the full viewport behind every dialog in the app (see src/components/ui/dialog.tsx) -- if its blur is ever
      // hardcoded again instead of routed through --lw-backdrop-blur, reduced-graphics mode would still pay for a full-screen blur on
      // every dialog open, silently defeating the fix everywhere dialogs are used.
      const backdrop = getBackdrop();
      expect(cssRulesForElement(backdrop)).toContain("--lw-backdrop-blur");
    });
  });

  describe("when consumers reach for the Dialog namespace", () => {
    /** @scenario Dialog.Backdrop is not exposed as a public sub-component */
    it("does not expose a Backdrop sub-component", () => {
      expect((Dialog as unknown as Record<string, unknown>).Backdrop).toBe(undefined);
    });
  });
});
