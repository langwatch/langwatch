/**
 * @vitest-environment jsdom
 *
 * The registry mechanism this exercises moved out of
 * `platform/app/src/components/drawerRegistry.ts` into this package's own
 * `lazyDrawer`/`preloadDrawer` (see drawer-registry.ts) — a feature package's
 * concrete drawers are composition now, so this ports as a test of the
 * mechanism itself with two throwaway lazy components rather than
 * ScenarioFormDrawer/PromptListDrawer.
 *
 * @see specs/navigation/drawer-chunk-warmup.feature
 */
import { render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { lazyDrawer, preloadDrawer, type UiDrawerRegistry } from "../drawer-registry";

const { secondLoads } = vi.hoisted(() => ({
  secondLoads: { count: 0 },
}));

const registry: UiDrawerRegistry = {
  warmed: lazyDrawer({
    factory: () =>
      Promise.resolve({
        Warmed: () => <div data-testid="warmed-drawer" />,
      }),
    key: "Warmed",
  }),
  flaky: lazyDrawer({
    factory: () => {
      secondLoads.count += 1;
      // The first load fails the way a file that a deploy removed does.
      if (secondLoads.count === 1) {
        return Promise.reject(new Error("Failed to fetch dynamically imported module"));
      }
      return Promise.resolve({
        Flaky: () => <div data-testid="flaky-drawer" />,
      });
    },
    key: "Flaky",
  }),
};

const renderDrawer = (Drawer: UiDrawerRegistry[string]) =>
  render(
    <Suspense fallback={<div data-testid="spinner" />}>
      <Drawer />
    </Suspense>,
  );

describe("preloadDrawer", () => {
  describe("given a drawer whose code is already fetched", () => {
    describe("when it is opened", () => {
      /** @scenario "A warmed drawer opens with no spinner in between" */
      it("renders at once", async () => {
        await preloadDrawer({ registry, drawer: "warmed" });

        renderDrawer(registry.warmed);

        expect(screen.getByTestId("warmed-drawer")).toBeInTheDocument();
        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a warm-up that could not fetch the code", () => {
    describe("when the drawer is opened later", () => {
      /** @scenario "A drawer whose warm-up failed can still be opened" */
      it("fetches the code again and opens", async () => {
        await expect(preloadDrawer({ registry, drawer: "flaky" })).resolves.toBeUndefined();

        renderDrawer(registry.flaky);

        expect(screen.getByTestId("spinner")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId("flaky-drawer")).toBeInTheDocument());
      });
    });
  });
});
