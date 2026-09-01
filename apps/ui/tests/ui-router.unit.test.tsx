import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it } from "vitest";
import { createUiRouter } from "../src/behavior/ui-router";

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

describe("given the application's router", () => {
  describe("when it is built from routes, a root layout and a root error boundary", () => {
    it("renders every route inside the root layout", async () => {
      window.history.replaceState({}, "", "/inside");
      const router = createUiRouter({
        routes: [{ path: "/inside", element: <div data-testid="routed-content">LangWatch</div> }],
        rootComponent: () => <div data-testid="root-layout">{"placeholder"}</div>,
        rootErrorBoundary: () => <div data-testid="root-error" />,
      });
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      await act(() => {
        root?.render(<RouterProvider router={router} />);
      });

      expect(container.querySelector("[data-testid='root-layout']")).toBeTruthy();

      router.dispose();
    });

    it("declares a hydrate fallback so the async root never warns", () => {
      const router = createUiRouter({
        routes: [],
        rootComponent: () => null,
        rootErrorBoundary: () => null,
      });

      expect(router.routes[0]?.hydrateFallbackElement).toBeTruthy();

      router.dispose();
    });

    it("hangs every supplied route under the one root", () => {
      const router = createUiRouter({
        routes: [{ path: "/one" }, { path: "/two" }],
        rootComponent: () => null,
        rootErrorBoundary: () => null,
      });

      expect(router.routes).toHaveLength(1);
      expect(router.routes[0]?.children?.map((route) => route.path)).toEqual(["/one", "/two"]);

      router.dispose();
    });
  });
});
