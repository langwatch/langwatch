/**
 * @vitest-environment jsdom
 *
 * The product flow's shape per flavour: every flavour goes straight to its own
 * setup screen.
 *
 * THE MODEL PROVIDER STEP IS NOT SERVED BY THIS PACKAGE, and these cases pin its
 * absence rather than pretending it never existed. It was a SKIPPABLE pre-step in
 * front of the "via the platform" flavour only, and it mounts `platform/app`'s
 * model-provider credential form — four `components/settings/*` modules,
 * `~/server/api/rbac` and `utils/modelProviderSync`, all of them the model-provider
 * family's own closure moving in a different slice. Taking them here would have
 * been a copy of another family's page.
 *
 * TWO SPEC BINDINGS WERE LOST TO THAT, and they are named rather than quietly
 * dropped: `specs/features/onboarding/model-provider-step.feature`'s "Only the
 * platform flavour passes through the step" now binds only through the
 * coding-agent cases below, and "Skipping advances without a provider" binds
 * nothing at all. Both come back with the step, which is one import and one
 * screen entry in `create-product-screens`.
 *
 * Spec: specs/features/onboarding/model-provider-step.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductScreenIndex } from "../types";
import { useProductFlow } from "../use-product-flow";

const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));

vi.mock("../next-router", () => ({
  useRouter: () => ({
    query: routerState.query,
    pathname: "/onboarding/product",
    asPath: "/onboarding/product",
    push: vi.fn((to: string | { pathname?: string; query?: Record<string, unknown> }) => {
      // Mirror the real router: the pushed query becomes the next
      // router.query, so the flow's URL-sync effects see their own writes.
      if (typeof to === "object" && to.query) {
        routerState.query = Object.fromEntries(
          Object.entries(to.query).map(([key, value]) => [key, String(value)]),
        );
      }
      return Promise.resolve(true);
    }),
  }),
}));

describe("useProductFlow", () => {
  beforeEach(() => {
    routerState.query = {};
  });

  describe("when the user picks the platform flavour", () => {
    it("goes straight to the platform screen with no model provider step", () => {
      const rendered = renderHook(() => useProductFlow());

      act(() => {
        rendered.result.current.handleSelectProduct("via-platform");
      });

      expect(rendered.result.current.flow.visibleScreens).toEqual([
        ProductScreenIndex.SELECTION,
        ProductScreenIndex.VIA_PLATFORM,
      ]);
      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.VIA_PLATFORM,
      );
    });

    it("goes back from the platform screen to the selection screen", () => {
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
    it("lands on the platform screen", () => {
      routerState.query = { product: "via-platform" };

      const rendered = renderHook(() => useProductFlow());

      expect(rendered.result.current.currentScreenIndex).toBe(
        ProductScreenIndex.VIA_PLATFORM,
      );
      expect(rendered.result.current.flow.visibleScreens).not.toContain(
        ProductScreenIndex.MODEL_PROVIDER,
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
