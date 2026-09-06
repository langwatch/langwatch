/**
 * @vitest-environment jsdom
 *
 * The product flow's shape per flavour: the platform flavour passes through
 * the skippable model provider step, the coding-agent flavours go straight
 * to their setup screen.
 *
 * Spec: specs/features/onboarding/model-provider-step.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductScreenIndex } from "../../types/types";
import { useProductFlow } from "../use-product-flow";

const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: routerState.query,
    pathname: "/onboarding/product",
    asPath: "/onboarding/product",
    push: vi.fn(
      (to: string | { pathname?: string; query?: Record<string, unknown> }) => {
        // Mirror the real router: the pushed query becomes the next
        // router.query, so the flow's URL-sync effects see their own writes.
        if (typeof to === "object" && to.query) {
          routerState.query = Object.fromEntries(
            Object.entries(to.query).map(([key, value]) => [
              key,
              String(value),
            ]),
          );
        }
        return Promise.resolve(true);
      },
    ),
  }),
}));

describe("useProductFlow", () => {
  beforeEach(() => {
    routerState.query = {};
  });

  describe("when the user picks the platform flavour", () => {
    /** @scenario "Only the platform flavour passes through the step" */
    it("inserts the model provider step between selection and the platform screen", () => {
      const rendered = renderHook(() => useProductFlow());

      act(() => {
        rendered.result.current.handleSelectProduct("via-platform");
      });

      expect(rendered.result.current.flow.visibleScreens).toEqual([
        ProductScreenIndex.SELECTION,
        ProductScreenIndex.MODEL_PROVIDER,
        ProductScreenIndex.VIA_PLATFORM,
      ]);
      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.MODEL_PROVIDER,
      );
    });

    /** @scenario "Skipping advances without a provider" */
    it("advances from the model provider step to the platform screen", () => {
      const rendered = renderHook(() => useProductFlow());

      act(() => {
        rendered.result.current.handleSelectProduct("via-platform");
      });
      act(() => {
        rendered.result.current.navigation.nextScreen();
      });

      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.VIA_PLATFORM,
      );
    });

    it("goes back from the model provider step to the selection screen", () => {
      const rendered = renderHook(() => useProductFlow());

      act(() => {
        rendered.result.current.handleSelectProduct("via-platform");
      });
      act(() => {
        rendered.result.current.navigation.prevScreen();
      });

      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.SELECTION,
      );
    });
  });

  describe("when the page loads with the platform flavour in the URL", () => {
    it("lands on the model provider step, not past it", () => {
      routerState.query = { product: "via-platform" };

      const rendered = renderHook(() => useProductFlow());

      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.MODEL_PROVIDER,
      );
      expect(rendered.result.current.flow.visibleScreens).toContain(
        ProductScreenIndex.VIA_PLATFORM,
      );
    });
  });

  describe.each([
    ["via-claude-code", ProductScreenIndex.VIA_CLAUDE_CODE],
    ["via-claude-desktop", ProductScreenIndex.VIA_CLAUDE_DESKTOP],
    ["manually", ProductScreenIndex.MANUALLY],
  ] as const)("when the user picks the %s flavour", (product, screen) => {
    /** @scenario "Only the platform flavour passes through the step" */
    it("goes straight to the flavour's screen with no model provider step", () => {
      const rendered = renderHook(() => useProductFlow());

      act(() => {
        rendered.result.current.handleSelectProduct(product);
      });

      expect(rendered.result.current.flow.visibleScreens).toEqual([
        ProductScreenIndex.SELECTION,
        screen,
      ]);
      expect(rendered.result.current.currentScreenIndex).toBe(screen);
    });
  });
});
