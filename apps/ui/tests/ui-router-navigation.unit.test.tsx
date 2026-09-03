import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiNavigationPort } from "../src/behavior/ui-capabilities";
import {
  createRouterUiNavigation,
  useRouterUiNavigation,
} from "../src/behavior/ui-router-navigation";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
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
      let navigation: UiNavigationPort | undefined;

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
