/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 *
 * Renders the real `Toaster` + `toaster.create` pipeline and reads the
 * computed style off the mounted toast root, so this proves the padding
 * override in `toaster.tsx` actually reaches the DOM through Chakra's style
 * engine — not just that the exported constant holds an expected value.
 * See `toaster.layout.unit.test.ts` for the numeric comparisons against
 * Chakra's real recipe/token values that don't need a render.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { toastSlotRecipe } from "@chakra-ui/react/theme";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster, toaster } from "../toaster";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given a rendered toast", () => {
  afterEach(() => {
    cleanup();
    toaster.dismiss();
  });

  describe("when it has no close button to reserve space for", () => {
    /** @scenario A toast without a close button is not shifted off-centre */
    it("the mounted root's end padding matches its start padding", async () => {
      render(<Toaster />, { wrapper: Wrapper });
      toaster.create({ title: "Automation created", type: "success" });

      const root = await waitFor(() => {
        const el = document.querySelector(
          '[data-scope="toast"][data-part="root"]',
        );
        if (!el) throw new Error("toast root not mounted yet");
        return el;
      });

      const style = getComputedStyle(root);
      // The override must have actually reached the DOM as the recipe's own
      // `ps` token (not the recipe's un-fixed `pe`, and not merely "some
      // truthy value").
      expect(style.paddingInlineEnd).toBe(
        `var(--chakra-spacing-${toastSlotRecipe.base.root.ps})`,
      );
      expect(style.paddingInlineEnd).not.toBe(
        `var(--chakra-spacing-${toastSlotRecipe.base.root.pe})`,
      );
    });
  });
});
