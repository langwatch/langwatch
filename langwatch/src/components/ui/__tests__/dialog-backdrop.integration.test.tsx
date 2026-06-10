/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Dialog backdrop styling.
 *
 * The base Dialog wrapper at src/components/ui/dialog.tsx must keep the
 * backdrop transparent (blur-only). Chakra's default backdrop ships with
 * `bg: blackAlpha.500` — the dark grey overlay we explicitly do not want.
 *
 * @see specs/features/dialog-backdrop-transparency-blur.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../dialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderOpenDialog(
  extra?: Parameters<typeof Dialog.Content>[0],
) {
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
  const backdrop = document.querySelector<HTMLElement>(
    "[data-part='backdrop']",
  );
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

      // The wrapper marks the backdrop with this data-attribute exactly
      // when the `bg="transparent"` hard-override is in place (see
      // src/components/ui/dialog.tsx). It is the only stable signal jsdom
      // can observe — Chakra resolves the `bg` prop through a CSS class
      // which jsdom cannot compute, so any inline-style assertion passes
      // vacuously even when a class-driven dark backdrop comes back. If
      // anyone removes the transparency override, this attribute is
      // removed alongside it and the test fails. The visual contract
      // itself is verified in the browser-QA pr-screenshots.
      expect(backdrop.getAttribute("data-lw-transparent-backdrop")).toBe(
        "true",
      );
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
      const inlineBg =
        backdrop.style.background || backdrop.style.backgroundColor;
      expect(inlineBg).not.toMatch(/blackalpha|rgba\(0,\s*0,\s*0,/i);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "backdropProps.bg/background/backgroundColor is ignored",
        ),
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
        expect.stringContaining(
          "backdropProps.bg/background/backgroundColor is ignored",
        ),
      );
      warn.mockRestore();
    });
  });

  describe("when consumers reach for the Dialog namespace", () => {
    /** @scenario Dialog.Backdrop is not exposed as a public sub-component */
    it("does not expose a Backdrop sub-component", () => {
      expect((Dialog as unknown as Record<string, unknown>).Backdrop).toBe(
        undefined,
      );
    });
  });
});
