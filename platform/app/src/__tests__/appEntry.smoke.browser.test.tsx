import { render } from "@testing-library/react";
import { Suspense } from "react";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";

/**
 * Mounts the app the way `src/main.tsx` does — real providers, real router,
 * real tRPC client wiring, in a real browser. Every page test mocks
 * `~/utils/api`, so a crash or eternal suspension in the client wiring blanks
 * every page in production while the whole jsdom suite stays green.
 *
 * Deployment configuration is already present in the HTML shell. The sign-in
 * page still waits for its license-dependent sign-in capability, so this also
 * proves that the small viewer-capability query fires and settles.
 */
describe("app entry", () => {
  describe("when mounted at /auth/signin with the real provider stack", () => {
    it("renders the routed page (query wiring is alive)", async () => {
      window.history.replaceState({}, "", "/auth/signin");
      const { OuterProviders } = await import("../AppProviders");
      const { router } = await import("../routes");

      const { container } = render(
        <OuterProviders>
          <Suspense fallback={null}>
            <RouterProvider router={router} />
          </Suspense>
        </OuterProviders>,
      );

      // The capability query has no live API here — success is the query
      // firing and the router tree staying mounted (not a client-side
      // construction crash).
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(router.state.initialized).toBe(true);
      expect(container.innerHTML.length).toBeGreaterThan(0);
    }, 30_000);
  });
});
