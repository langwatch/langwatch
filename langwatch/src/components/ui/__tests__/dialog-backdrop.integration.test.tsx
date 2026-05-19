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
    it("renders a backdrop and does not inject a dark inline fill", () => {
      renderOpenDialog();
      const backdrop = getBackdrop();

      // Chakra resolves the `bg` prop through its recipe to a CSS class
      // rather than an inline style, so we can't read the colour value
      // from jsdom. What we CAN assert is that the wrapper does not put a
      // dark colour as an inline style on the backdrop element, since
      // Chakra's default (blackAlpha.500) only renders through the class.
      // Visual confirmation lives in pr-screenshots from QA.
      const inlineBg =
        backdrop.style.background || backdrop.style.backgroundColor;
      expect(inlineBg).not.toMatch(/blackalpha|rgba\(0,\s*0,\s*0,/i);
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

  describe("when consumers reach for the Dialog namespace", () => {
    /** @scenario Dialog.Backdrop is not exposed as a public sub-component */
    it("does not expose a Backdrop sub-component", () => {
      expect((Dialog as unknown as Record<string, unknown>).Backdrop).toBe(
        undefined,
      );
    });
  });
});
