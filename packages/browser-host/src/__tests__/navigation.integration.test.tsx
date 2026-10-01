import { render } from "@testing-library/react";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RouterProvider as DomRouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiNavigation } from "../capabilities.ts";
import { createRouterUiNavigation, createUiRouter, useRouterUiNavigation } from "../navigation.ts";

let root: Root | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  dispose?.();
  dispose = void 0;
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

      act(() => {
        root?.render(<DomRouterProvider router={router} />);
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
      expect(router.routes[0]?.children?.map((route: { path?: string }) => route.path)).toEqual([
        "/one",
        "/two",
      ]);

      router.dispose();
    });
  });
});

describe("given the navigation capability over a router", () => {
  describe("when a screen moves the address bar", () => {
    it("pushes for a navigate and replaces for a replace", () => {
      const navigate = vi.fn();

      const navigation = createRouterUiNavigation({ navigate });
      navigation.navigate("/settings");
      navigation.replace("/settings/members");

      expect(navigate.mock.calls).toEqual([
        ["/settings"],
        ["/settings/members", { replace: true }],
      ]);
    });
  });

  describe("when a screen goes back", () => {
    it("asks the router for the previous history entry", () => {
      const navigate = vi.fn();

      createRouterUiNavigation({ navigate }).back();

      expect(navigate).toHaveBeenCalledWith(-1);
    });
  });
});

describe("given a screen rendered inside the application's router", () => {
  describe("when it asks for the navigation capability", () => {
    it("moves the router the page is actually mounted in", () => {
      let navigation: UiNavigation | undefined;

      function Page() {
        navigation = useRouterUiNavigation();
        return <div>page</div>;
      }

      const router = createMemoryRouter(
        [
          { path: "/", element: <Page /> },
          { path: "/settings", element: <div>settings</div> },
        ],
        { initialEntries: ["/"] },
      );
      const view = render(<RouterProvider router={router} />);
      dispose = () => {
        view.unmount();
        router.dispose();
      };

      navigation?.navigate("/settings");

      expect(router.state.location.pathname).toBe("/settings");
    });
  });
});
