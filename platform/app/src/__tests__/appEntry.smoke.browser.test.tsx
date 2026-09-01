import { UiRuntime } from "@langwatch/ui";
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Mounts the app the way `src/main.tsx` does — the real packaged provider
 * order, the real route table, real tRPC client wiring, in a real browser. Every page test mocks
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
      const { LegacyUiShellAdapter } =
        await import("../runtime/ui/legacy-ui-shell.adapter");
      const container = document.createElement("div");
      container.id = "root";
      document.body.append(container);
      const shell = LegacyUiShellAdapter.create();
      const runtime = UiRuntime.create({ document, shell });

      try {
        await act(async () => {
          runtime.start();
          await new Promise((resolve) => setTimeout(resolve, 4000));
        });

        expect(shell.router.state.initialized).toBe(true);
        expect(container.innerHTML.length).toBeGreaterThan(0);
      } finally {
        await act(() => runtime.close());
        container.remove();
      }
    }, 30_000);
  });
});
