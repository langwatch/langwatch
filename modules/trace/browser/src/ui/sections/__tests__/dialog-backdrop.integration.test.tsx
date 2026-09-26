/**
 * Integration tests for the Dialog backdrop styling.
 * @vitest-environment jsdom
 * @see specs/features/dialog-backdrop-transparency-blur.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  UiCapabilityContextProvider,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "../dialog.tsx";
import { cssRulesForElement } from "./emotion-test-css.ts";

/** The misuse warning is a development affordance, so the shell says so here. */
const capabilities: UiCapabilities = {
  ...createUiCapabilitiesFromHost({
    route: () => ({ params: {}, query: {} }),
    navigate: () => void 0,
  }),
  deployment: {
    isDevelopment: true,
    isSaaS: false,
    appBaseUrl: "https://app.langwatch.test",
    hasNlpService: false,
    hasLangevals: false,
    hasEmailProvider: false,
  },
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <UiCapabilityContextProvider value={capabilities}>{children}</UiCapabilityContextProvider>
  </ChakraProvider>
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
      // A props object built elsewhere escapes the literal-only Omit check;
      // the runtime guard is what holds.
      const callerBackdropProps = { className: "caller-backdrop", bg: "blackAlpha.700" };
      renderOpenDialog({ backdropProps: callerBackdropProps });
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
        },
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

      // Backdrop blur via --lw-backdrop-blur, not hardcoded (reduced-graphics mode).
      //
      const backdrop = getBackdrop();
      expect(cssRulesForElement(backdrop)).toContain("--lw-backdrop-blur");
    });
  });

  describe("when consumers reach for the Dialog namespace", () => {
    /** @scenario Dialog.Backdrop is not exposed as a public sub-component */
    it("does not expose a Backdrop sub-component", () => {
      expect("Backdrop" in Dialog).toBe(false);
    });
  });
});
